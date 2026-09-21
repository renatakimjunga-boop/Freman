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

function rewriteHtml(html: string, baseUrl: string): string {
  const absolutize = (value: string): string => {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  };

  // Route every navigable/asset URL through the proxy.
  const proxied = (value: string): string => {
    const abs = absolutize(value);
    if (!/^https?:\/\//i.test(abs)) return abs;
    return `/fetchProxy?url=${encodeURIComponent(abs)}`;
  };

  let out = html;

  // <base> would fight our own rewrites; drop it.
  out = out.replace(/<base\b[^>]*>/gi, "");

  const attrs: [RegExp, string][] = [
    [/\s(?:href|poster|data-src)\s*=\s*"([^"]*)"/gi, "$1"],
    [/\s(?:href|poster|data-src)\s*=\s*'([^']*)'/gi, "$1"],
    [/\s(?:src|srcset)\s*=\s*"([^"]*)"/gi, "$1"],
    [/\s(?:src|srcset)\s*=\s*'([^']*)'/gi, "$1"],
  ];

  for (const [pattern] of attrs) {
    out = out.replace(pattern, (match, url: string) => {
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
      const rewritten = pattern.source.includes("srcset") && url.includes(",")
        ? url
            .split(",")
            .map((candidate) => {
              const trimmed = candidate.trim();
              const [target, ...descriptors] = trimmed.split(/\s+/);
              return `${proxied(target)} ${descriptors.join(" ")}`.trim();
            })
            .join(", ")
        : proxied(url);
      return ` ${match.trim().split(/\s=/)[0]}=${quote}${rewritten}${quote}`;
    });
  }

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

export const fetchProxy = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const mobile = params.get("view") === "mobile";
  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response("Missing or invalid ?url", { status: 400 });
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

  // Non-HTML (images, fonts, css, json) passes through untouched.
  if (!contentType.includes("text/html")) {
    const buffer = await upstream.arrayBuffer();
    if (!headers.get("content-type")) {
      headers.set("content-type", contentType || "application/octet-stream");
    }
    return new Response(buffer, { status: upstream.status, headers });
  }

  const html = await upstream.text();
  const rewritten = rewriteHtml(html, upstream.url || url);

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
