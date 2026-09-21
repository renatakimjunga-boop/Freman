"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Live Chrome Web Store integration for Freman.
 *
 * Two modes:
 *  1. Public catalog (always on) — searches and reads the real Chrome Web
 *     Store (chromewebstore.google.com) so Freman users can browse every
 *     extension actually listed in the store: real names, publishers, ratings
 *     and icons. No API key required and nothing mocked.
 *  2. Official publisher mode (OAuth) — uses the Google OAuth client
 *     (GOOGLE_CLIENT_ID, set) plus GOOGLE_CLIENT_SECRET and
 *     GOOGLE_REFRESH_TOKEN when provided, to talk to the official Chrome Web
 *     Store API and surface the publisher's own listed items and install
 *     statistics.
 */

interface StoreCard {
  id: string;
  name: string;
  publisher: string | null;
  rating: number | null;
  icon: string | null;
  url: string;
}

interface StoreDetails extends StoreCard {
  description: string | null;
  users: string | null;
  version: string | null;
  size: string | null;
  updated: string | null;
  category: string | null;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BASE = "https://chromewebstore.google.com";

/* ------------------------------ html helpers ------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).trim();
}

/** Normalise a googleusercontent image to a crisp square icon. */
function iconUrl(raw: string | null, size = 128): string | null {
  if (!raw) return null;
  const base = raw.split("=")[0];
  return `${base}=s${size}`;
}

function storeUrl(id: string, slug?: string): string {
  return `${BASE}/detail/${slug ?? "extension"}/${id}`;
}

/* ------------------------------- caching --------------------------------- */

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/* ---------------------------- public scraping ----------------------------- */

function parseCards(html: string): StoreCard[] {
  const cards: StoreCard[] = [];
  // Every result card is anchored by a data-item-id attribute holding the
  // 32-character extension id (letters a–p, per Chrome's id alphabet).
  const chunks = html.split('data-item-id="').slice(1);
  for (const chunk of chunks) {
    const id = chunk.slice(0, 32);
    if (!/^[a-p]{32}$/.test(id)) continue;
    if (cards.some((c) => c.id === id)) continue;

    const name = chunk.match(/<h2 class="CiI2if">([\s\S]*?)<\/h2>/);
    const publisher = chunk.match(/class="cJI8ee[^"]*">([^<]+)</);
    const rating = chunk.match(/class="Vq0ZA">([\d.]+)</);
    const icon = chunk.match(/<img src="(https:\/\/lh3\.googleusercontent\.com\/[^"]+)"/);
    const slug = chunk.match(/href="\.\/detail\/([a-z0-9-]+)\//);

    cards.push({
      id,
      name: name ? decodeEntities(name[1]).trim() : `Extension ${id}`,
      publisher: publisher ? decodeEntities(publisher[1]).trim() : null,
      rating: rating ? Number(rating[1]) : null,
      icon: iconUrl(icon ? icon[1] : null),
      url: storeUrl(id, slug ? slug[1] : undefined),
    });
  }
  return cards;
}

async function fetchStorePage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Chrome Web Store returned ${res.status}`);
  }
  return res.text();
}

/* --------------------------- official OAuth mode -------------------------- */

interface TokenEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function oauthEnv(): TokenEnv | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function accessToken(env: TokenEnv): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: env.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ?? json.error ?? "Google token refresh failed",
    );
  }
  return json.access_token;
}

/* -------------------------------- status ---------------------------------- */

/** Which integration modes are configured right now. */
export const status = action({
  args: {},
  returns: v.any(),
  handler: () => {
    const clientId = Boolean(process.env.GOOGLE_CLIENT_ID);
    const full = Boolean(
      clientId &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN,
    );
    return {
      clientIdConfigured: clientId,
      publisherConnected: full,
      searchMode: "public" as const,
    };
  },
});

/* -------------------------------- actions --------------------------------- */

/** Search the live Chrome Web Store catalog. Always real data. */
export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (_, { query: q, limit }) => {
    const term = q.trim().slice(0, 120);
    if (!term) return { results: [], source: "store" as const };
    const max = Math.min(Math.max(limit ?? 12, 1), 24);

    return cached(`search:${term.toLowerCase()}:${max}`, async () => {
      const html = await fetchStorePage(
        `${BASE}/search/${encodeURIComponent(term)}`,
      );
      const results = parseCards(html).slice(0, max);
      return { results, source: "store" as const };
    });
  },
});

/** Full live details for one extension (users, version, updated, …). */
export const details = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (_, { id }) => {
    if (!/^[a-p]{32}$/.test(id)) throw new Error("Invalid extension id");

    return cached(`details:${id}`, async () => {
      const html = await fetchStorePage(`${BASE}/detail/x/${id}`);

      const og = (prop: string) =>
        html.match(
          new RegExp(`property="og:${prop}" content="([^"]+)"`),
        )?.[1] ?? null;

      const users = html.match(/>([\d,]+) users</)?.[1] ?? null;
      const rating =
        html.match(/aria-label="Average rating ([\d.]+) out of 5/)?.[1] ?? null;
      const version =
        html.match(/<div class="QDHp8e">Version<\/div><div[^>]*>([^<]+)</)?.[1] ??
        null;
      const size =
        html.match(/<div class="QDHp8e">Size<\/div><div[^>]*>([^<]+)</)?.[1] ??
        null;
      const updated =
        html.match(/<div class="QDHp8e">Updated<\/div><div>([^<]+)</)?.[1] ??
        null;
      const category = stripTags(
        html.match(/<a class="gqpEIe[^"]*" href="\.\/category\/[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "",
      ) || null;

      const developer =
        html.match(
          /<div class="QDHp8e">Developer<\/div><div[^>]*>(?:<div[^>]*>)?<div class="mdSapd">([^<\n]+)/,
        )?.[1] ?? null;

      const details: StoreDetails = {
        id,
        name: (og("title") ?? "").replace(/ - Chrome Web Store$/, "") || `Extension ${id}`,
        publisher: developer ?? og("author"),
        rating: rating ? Number(rating) : null,
        icon: iconUrl(og("image")),
        url: storeUrl(id),
        description: og("description") ? decodeEntities(og("description") as string) : null,
        users,
        version,
        size,
        updated,
        category,
      };
      return details;
    });
  },
});

/**
 * Official Web Store publisher account (OAuth). Requires the OAuth client
 * credentials plus a refresh token with the chromewebstore scope; returns the
 * publisher's listed items and, when the publisher id is configured, live
 * install statistics.
 */
export const publisherAccount = action({
  args: {},
  returns: v.any(),
  handler: async () => {
    const env = oauthEnv();
    if (!env) {
      return {
        connected: false,
        reason:
          "Publisher mode needs GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (the OAuth client ID is already configured).",
      };
    }

    try {
      const token = await accessToken(env);
      const publisherId = process.env.GOOGLE_PUBLISHER_ID;

      // Listed items for this publisher.
      const itemsRes = await fetch(
        `https://chromewebstore.googleapis.com/v2/publishers/${publisherId ?? "-"}/items`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const itemsJson = (await itemsRes.json()) as Record<string, unknown>;

      if (!itemsRes.ok) {
        const err = itemsJson as { error?: { message?: string } };
        return {
          connected: true,
          items: [],
          error:
            err.error?.message ??
            `Official API returned ${itemsRes.status}${
              publisherId ? "" : " — set GOOGLE_PUBLISHER_ID to your publisher id"
            }`,
        };
      }

      const rawItems = (itemsJson.items ?? []) as Array<Record<string, unknown>>;

      // Live install counts, when stats are reachable for this publisher.
      let statsByItem = new Map<string, number>();
      if (publisherId) {
        const date = new Date();
        const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
        const statsRes = await fetch(
          `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/stats?metric=INSTALLATION_COUNT&date=${ymd}&dimension=ITEM`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (statsRes.ok) {
          const statsJson = (await statsRes.json()) as {
            rows?: Array<{ item?: string; value?: string | number }>;
          };
          statsByItem = new Map(
            (statsJson.rows ?? [])
              .filter((r) => r.item)
              .map((r) => [r.item as string, Number(r.value ?? 0)]),
          );
        }
      }

      return {
        connected: true,
        items: rawItems.map((it) => {
          const itemId = String(it.itemId ?? it.id ?? "");
          return {
            id: itemId,
            name: String(it.displayName ?? it.name ?? it.localizedText ?? itemId),
            status: String(it.status ?? it.publishStatus ?? "unknown"),
            installs: statsByItem.get(itemId) ?? null,
          };
        }),
        error: null as string | null,
      };
    } catch (e) {
      return {
        connected: true,
        items: [],
        error: e instanceof Error ? e.message : "Official API request failed",
      };
    }
  },
});
