"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Market data for the wallet's balance area, straight from CoinGecko's free
 * public API (no key, rate-limited). Nothing is cached server-side — the
 * client refreshes on demand.
 */

const CG = "https://api.coingecko.com/api/v3";

async function cgFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${CG}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) {
    throw new Error("Price API rate-limited — try again in a moment.");
  }
  if (!res.ok) throw new Error(`Price API error (${res.status})`);
  return (await res.json()) as T;
}

/** CoinGecko ids for Freman's supported networks. */
export const NETWORK_COIN_IDS: Record<string, string> = {
  mainnet: "ethereum",
  sepolia: "ethereum",
  arbitrum: "ethereum",
  base: "ethereum",
  polygon: "matic-network",
  bsc: "binancecoin",
  "solana:mainnet": "solana",
  "solana:devnet": "solana",
  "tron:mainnet": "tron",
  "tron:nile": "tron",
};

/** CoinGecko ids for the well-known tokens shown in the wallet. */
export const TOKEN_COIN_IDS: Record<string, string> = {
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  LINK: "chainlink",
  UNI: "uniswap",
  SHIB: "shiba-inu",
};

/** USD price history for a native asset (drives the balance chart). */
export const priceHistory = action({
  args: {
    network: v.string(),
    days: v.union(v.literal("1"), v.literal("7"), v.literal("30")),
  },
  returns: v.object({
    coinId: v.string(),
    current: v.number(),
    change24h: v.number(),
    points: v.array(v.object({ t: v.number(), p: v.number() })),
  }),
  handler: async (ctx, { network, days }) => {
    void ctx;
    const coinId = NETWORK_COIN_IDS[network];
    if (!coinId) throw new Error(`No price feed for ${network}`);
    const [chart, simple] = await Promise.all([
      cgFetch<{ prices: Array<[number, number]> }>(
        `/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      ),
      cgFetch<Record<string, { usd: number; usd_24h_change?: number }>>(
        `/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
      ),
    ]);
    return {
      coinId,
      current: simple[coinId]?.usd ?? chart.prices.at(-1)?.[1] ?? 0,
      change24h: simple[coinId]?.usd_24h_change ?? 0,
      points: chart.prices.map(([t, p]) => ({ t, p })),
    };
  },
});

/** USD prices + 24h change for a list of CoinGecko ids. */
export const tokenPrices = action({
  args: { ids: v.array(v.string()) },
  returns: v.record(
    v.string(),
    v.object({ usd: v.number(), change24h: v.number() }),
  ),
  handler: async (ctx, { ids }) => {
    void ctx;
    if (ids.length === 0) return {};
    const simple = await cgFetch<
      Record<string, { usd: number; usd_24h_change?: number }>
    >(
      `/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`,
    );
    return Object.fromEntries(
      Object.entries(simple).map(([id, v]) => [
        id,
        { usd: v.usd ?? 0, change24h: v.usd_24h_change ?? 0 },
      ]),
    );
  },
});
