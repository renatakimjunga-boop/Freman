import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { api, internal } from "./_generated/api";

/**
 * Embeddable page proxy.
 *
 * Freman renders pages in its own viewport. Many sites send
 * `X-Frame-Options` / `frame-ancestors`, which would refuse to load. This
 * route fetches the page server-side, strips the frame-blocking headers, and
 * re-serves the content — plus rewrites asset/link URLs so CSS, images and
 * navigation keep working from inside the proxy.
 */

const BLOCKED_HEADERS_TO_STRIP = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
];

const PASSTHROUGH_HEADERS = [
  "content-type",
  "cache-control",
  "content-language",
];

/** Real browser user-agents — mobile mode rewrites pages like a phone would see them. */
const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function rewriteHtml(
  html: string,
  baseUrl: string,
  proxyOrigin: string,
): string {
  const absolutize = (value: string): string => {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  };

  // Route every navigable/asset URL through the proxy. Proxied URLs must be
  // ABSOLUTE — the injected <base href> points at the target site, so a
  // relative "/fetchProxy?…" would resolve against the target and 404.
  const proxied = (value: string): string => {
    const abs = absolutize(value);
    if (!/^https?:\/\//i.test(abs)) return abs;
    return `${proxyOrigin}/fetchProxy?url=${encodeURIComponent(abs)}`;
  };

  let out = html;

  // <base> would fight our own rewrites; drop it.
  out = out.replace(/<base\b[^>]*>/gi, "");

  // Capture the attribute NAME so we can rebuild `name="value"` exactly;
  // reconstructing it from the match text is what mangled attributes before.
  const attrs: RegExp[] = [
    /\s(href|poster|data-src)\s*=\s*"([^"]*)"/gi,
    /\s(href|poster|data-src)\s*=\s*'([^']*)'/gi,
    /\s(src|srcset)\s*=\s*"([^"]*)"/gi,
    /\s(src|srcset)\s*=\s*'([^']*)'/gi,
  ];

  for (const pattern of attrs) {
    out = out.replace(pattern, (match, name: string, url: string) => {
      // Skip anchors, protocols we can't proxy, and data URLs.
      if (
        !url ||
        url.startsWith("#") ||
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        url.startsWith("javascript:") ||
        url.startsWith("mailto:") ||
        url.startsWith("tel:")
      ) {
        return match;
      }
      const quote = match.includes('"') ? '"' : "'";
      const rewritten =
        name.toLowerCase() === "srcset" && url.includes(",")
          ? url
              .split(",")
              .map((candidate) => {
                const trimmed = candidate.trim();
                const [target, ...descriptors] = trimmed.split(/\s+/);
                return `${proxied(target)} ${descriptors.join(" ")}`.trim();
              })
              .join(", ")
          : proxied(url);
      return ` ${name}=${quote}${rewritten}${quote}`;
    });
  }

  // Rewritten subresources come from our origin, so Subresource-Integrity
  // hashes would no longer match and scripts/styles would be blocked.
  out = out.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*')/gi, "");

  // Neutralize meta-refresh redirects (they'd escape the proxy).
  out = out.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "");

  // Open links in the proxy viewport, not a new tab.
  out = out.replace(/<head([^>]*)>/i, (match, attrsHead: string) =>
    /<base/i.test(attrsHead)
      ? match
      : `${match}\n<base href="${baseUrl}">`,
  );

  return out;
}

/**
 * Rewrites url(...) refs and @import rules inside a stylesheet so images,
 * fonts and nested imports also route through the proxy. Inline <style>
 * blocks get the same treatment via rewriteHtml.
 */
function rewriteCss(css: string, baseUrl: string, proxyOrigin: string): string {
  const absolutize = (value: string): string => {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  };
  const proxied = (value: string): string => {
    const abs = absolutize(value);
    if (!/^https?:\/\//i.test(abs)) return abs;
    return `${proxyOrigin}/fetchProxy?url=${encodeURIComponent(abs)}`;
  };

  // @import "x.css"; / @import url(x.css) — must be handled first so the
  // imported sheet is itself fetched through the proxy and re-rewritten.
  let out = css.replace(
    /@import\s+(?:url\(\s*)?["']?([^"')]+)["']?\s*\)?\s*([^;]*);/gi,
    (match, target: string) => {
      const t = target.trim();
      if (!t || t.startsWith("data:") || t.startsWith("blob:")) return match;
      return match.replace(target, proxied(t));
    },
  );

  // url(...) for backgrounds, fonts, cursors, etc.
  out = out.replace(
    /url\(\s*("([^"]*)"|'([^']*)'|([^)'"][^)]*?))\s*\)/gi,
    (match, _q, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
      const target = (dq ?? sq ?? bare ?? "").trim();
      if (
        !target ||
        target.startsWith("data:") ||
        target.startsWith("blob:") ||
        target.startsWith("#")
      ) {
        return match;
      }
      // Preserve the original quoting style.
      if (dq !== undefined) return `url("${proxied(dq)}")`;
      if (sq !== undefined) return `url('${proxied(sq)}')`;
      return `url(${proxied(bare ?? "")})`;
    },
  );

  return out;
}

/* ------------------------------ Safe Browsing ------------------------------ */

/** Static subresources (css/js/img/font) skip the threat check. */
const SAFE_RESOURCE_PATH =
  /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|map|json|xml|txt)(\?|$)/i;

interface SafeBrowsingMatch {
  threatType: string;
}

/**
 * Query Google Safe Browsing (v4 lookup API) for a single URL. Returns the
 * first matching threat, or null when clean / unchecked. Any failure is
 * treated as "clean" — a broken key must never block the browser.
 */
async function safeBrowsingThreat(url: string): Promise<SafeBrowsingMatch | null> {
  const key = process.env.SAFE_BROWSING_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "freman", clientVersion: "1.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      matches?: Array<{ threatType?: string }>;
    };
    const first = json.matches?.[0];
    if (!first) return null;
    return { threatType: first.threatType ?? "THREAT" };
  } catch {
    return null;
  }
}

/** Branded warning page shown instead of a flagged site. */
function safeBrowsingInterstitial(url: string, threat: SafeBrowsingMatch): string {
  const label = threat.threatType.split("_").join(" ").toLowerCase();
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const overrideUrl = `${url}${url.includes("?") ? "&" : "?"}override=1`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dangerous site blocked — Freman</title>
<style>
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: #000; color: #fafafa;
  }
  .card { max-width: 34rem; padding: 0 1.5rem; }
  .tag {
    display: inline-flex; align-items: center; gap: .5rem;
    font-size: .6875rem; letter-spacing: .18em; text-transform: uppercase;
    color: #f42a17; border: 1px solid #f42a1755; border-radius: 999px;
    padding: .3rem .8rem; margin-bottom: 1.5rem;
  }
  h1 { font-size: 1.375rem; font-weight: 600; margin: 0 0 .75rem; }
  p { font-size: .875rem; line-height: 1.6; color: #a3a3a3; margin: 0 0 1rem; }
  code { font-size: .8125rem; color: #e5e5e5; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.75rem; }
  a.back {
    display: inline-block; padding: .55rem 1.25rem; border-radius: 999px;
    background: #f42a17; color: #fff; font-size: .8125rem; font-weight: 500;
    text-decoration: none;
  }
  a.go {
    display: inline-block; padding: .55rem 1.25rem; border-radius: 999px;
    border: 1px solid #404040; color: #a3a3a3; font-size: .8125rem;
    text-decoration: none;
  }
  a.go:hover { color: #fafafa; border-color: #737373; }
</style>
</head>
<body>
  <div class="card">
    <span class="tag">Freman · Safe Browsing</span>
    <h1>Dangerous site blocked</h1>
    <p>
      Google Safe Browsing flagged <code>${host}</code> as
      <strong>${label}</strong>. These pages try to steal passwords or install
      malicious software.
    </p>
    <p>Freman blocked this page before it could load anything.</p>
    <div class="actions">
      <a class="go" href="javascript:history.back()">Go back to safety</a>
      <a class="back" href="${overrideUrl.replace(/"/g, "%22")}">Ignore the risk and open anyway</a>
    </div>
  </div>
</body>
</html>`;
}

export const fetchProxy = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const mobile = params.get("view") === "mobile";
  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response("Missing or invalid ?url", { status: 400 });
  }

  // Safe Browsing gate — checks page navigations against Google's lists and
  // shows a branded warning interstitial. Fails open (network/API errors
  // never block browsing) and honours an explicit ?override=1 for sites the
  // user has chosen to visit anyway. Subresources skip the check.
  const override = params.get("override") === "1";
  const isNavigation = !SAFE_RESOURCE_PATH.test(new URL(url).pathname);
  if (!override && isNavigation) {
    const threat = await safeBrowsingThreat(url);
    if (threat) {
      return new Response(safeBrowsingInterstitial(url, threat), {
        status: 403,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": mobile ? UA_MOBILE : UA_DESKTOP,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;color:#666"><p>Freman couldn't reach ${url}</p></body>`,
      { status: 502, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("access-control-allow-origin", "*");

  // Stylesheets need url()/@import rewriting; everything else non-HTML
  // (images, fonts, json) passes through untouched.
  if (!contentType.includes("text/html")) {
    if (contentType.includes("text/css")) {
      const css = await upstream.text();
      const rewritten = rewriteCss(
        css,
        upstream.url || url,
        new URL(request.url).origin,
      );
      if (!headers.get("content-type")) {
        headers.set("content-type", contentType);
      }
      return new Response(rewritten, { status: upstream.status, headers });
    }
    const buffer = await upstream.arrayBuffer();
    if (!headers.get("content-type")) {
      headers.set("content-type", contentType || "application/octet-stream");
    }
    return new Response(buffer, { status: upstream.status, headers });
  }

  const html = await upstream.text();
  const rewritten = rewriteHtml(
    html,
    upstream.url || url,
    new URL(request.url).origin,
  );

  if (!headers.get("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(rewritten, { status: upstream.status, headers });
});

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/fetchProxy",
  method: "GET",
  handler: fetchProxy,
});

/* --------------------- Chrome Web Store publisher OAuth ------------------- */

/**
 * Publisher connect callback.
 *
 * `publisher.startConnect` (an authenticated action) builds the Google
 * consent URL with PKCE and stores the verifier + Freman user id in the
 * publisherOauthStates table. Google redirects here; the exchange runs in
 * the internal action `publisher.exchangeOnCallback`, because this request
 * carries no Freman session — the user binding comes from the state row.
 */

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>${title} · Freman</title>` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#000;color:#fff}` +
      `main{text-align:center;max-width:32rem;padding:2rem}h1{font-size:1.15rem;font-weight:600;letter-spacing:-0.01em}` +
      `p{color:#a1a1aa;font-size:.9rem;line-height:1.6}</style></head>` +
      `<body><main><h1>${title}</h1>${body}` +
      `<p style="margin-top:1.5rem"><a href="javascript:window.close()" style="color:#f42a17">Close this window</a></p></main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const publisherCallback = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  const siteUrl = process.env.CONVEX_SITE_URL;
  const redirectUri = siteUrl
    ? `${siteUrl.replace(/\/$/, "")}/publisher/oauth/callback`
    : new URL(request.url).origin + "/publisher/oauth/callback";

  if (error || !code || !state) {
    return page(
      "Connection failed",
      `<p>${
        error
          ? `Google returned “${error}”.`
          : "The connect attempt was invalid. Start again from the Studio."
      }</p>`,
    );
  }

  let result: {
    ok: boolean;
    error?: string;
    email?: string | null;
    appOrigin?: string | null;
  };
  try {
    result = (await ctx.runAction(internal.publisher.exchangeOnCallback, {
      state,
      code,
      redirectUri,
    })) as typeof result;
  } catch (e) {
    result = {
      ok: false,
      error: e instanceof Error ? e.message : "Token exchange failed",
    };
  }

  const appOrigin = result.appOrigin ?? siteUrl ?? null;

  if (!result.ok) {
    return page(
      "Connection failed",
      `<p>${
        result.error === "expired"
          ? "The connect attempt expired — start again from the Studio."
          : (result.error ?? "Token exchange failed.")
      }</p>`,
    );
  }

  return page(
    "Publisher connected",
    `<p>${
      result.email ? `${result.email} is now` : "Your account is"
    } linked to Freman. Return to the Studio to upload and publish extensions.</p>` +
      `<script>if (window.opener && ${JSON.stringify(appOrigin)}) { window.opener.postMessage({ type: "freman-publisher-connected", email: ${JSON.stringify(result.email ?? null)} }, ${JSON.stringify(appOrigin)}); }</script>`,
  );
});

http.route({
  path: "/publisher/oauth/callback",
  method: "GET",
  handler: publisherCallback,
});

export default http;
