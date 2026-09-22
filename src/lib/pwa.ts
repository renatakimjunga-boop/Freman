/**
 * Freman Browser — PWA plumbing.
 *
 * Responsibilities:
 *  1. Service-worker registration + update detection (updates are applied on
 *     next launch; the page can request an immediate activation via
 *     applyServiceWorkerUpdate()).
 *  2. Registration of the "web+freman" custom protocol handler
 *     (navigator.registerProtocolHandler).
 *  3. Parsing of protocol launch URLs — web+freman://open/<url> resolves to
 *     /?proto=<encoded destination>, which the router picks up.
 */

const SW_PATH = "/sw.js";

/** Registers the service worker and returns an unregister function. */
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
      updateViaCache: "none",
    });

    // Surface update events so the UI can offer a refresh.
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent("freman:sw-update-ready"));
        }
      });
    });
  } catch (err) {
    console.warn("[PWA] Service worker registration failed:", err);
  }
}

/** Tells the waiting worker to take over, then reloads once it's active. */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = registration?.waiting;
  if (!worker) return;
  worker.postMessage("SKIP_WAITING");
  worker.addEventListener("statechange", () => {
    if (worker.state === "activated") window.location.reload();
  });
}

/**
 * Registers "web+freman" as a protocol handler for this origin. Must run in a
 * user-gesture-adjacent context to be accepted without a prompt; harmless
 * otherwise (Chrome logs a console notice and moves on).
 */
export function registerProtocolHandler(): void {
  try {
    if (!("registerProtocolHandler" in navigator)) return;
    navigator.registerProtocolHandler(
      "web+freman",
      "/?proto=%s",
    );
  } catch (err) {
    console.warn("[PWA] Protocol handler registration failed:", err);
  }
}

/**
 * Extracts a destination URL from a web+freman launch URL.
 *
 * Supported shapes:
 *   web+freman://open/https://example.com   (handler form, %s = full URL)
 *   web+freman://open/https%3A%2F%2F...     (percent-encoded form)
 *   https://site/?proto=web%2Bfreman%3A%2F%2Fopen%2Fhttps%3A%2F%2Fexample.com
 */
export function extractProtoDestination(search: string): string | null {
  const params = new URLSearchParams(search);
  const protoParam = params.get("proto");
  if (!protoParam) return null;

  // URLSearchParams decodes "+" as a space; undo that mangling if the OS
  // delivered the launch URL partially decoded.
  let raw = protoParam.trim().replace(/\s/g, "+");
  if (!raw.startsWith("web+freman:")) return null;

  // Strip the scheme and optional authority: web+freman://open/<rest>
  const afterScheme = raw.replace(/^web\+freman:\/\//, "");
  // afterScheme is now "open/https://example.com" or "open/<encoded>".
  const rest = afterScheme.replace(/^[^/]+\/?/, "");
  if (!rest) return null;

  let destination = rest;
  try {
    // Handle double-encoded destinations from the manifest %s substitution.
    if (/^https?%3A/i.test(rest) || /^%2F/i.test(rest)) {
      destination = decodeURIComponent(rest);
    }
    const parsed = new URL(destination);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Removes the protocol-launch query params from the address bar. */
export function clearProtoQuery(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("proto")) return;
    url.searchParams.delete("proto");
    url.searchParams.delete("source");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // Ignore — the address bar is cosmetic.
  }
}
