import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

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

export default http;
