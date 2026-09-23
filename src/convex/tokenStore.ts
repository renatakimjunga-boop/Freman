import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

/**
 * Storage layer for the user's custom token list (see tokens.ts for the
 * on-chain verification that feeds these). Kept in a separate module from
 * `tokens.ts` so Convex's generated API types stay acyclic.
 */

export const listForNetwork = query({
  args: { network: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("customTokens"),
      network: v.string(),
      contract: v.string(),
      symbol: v.string(),
      name: v.string(),
      decimals: v.number(),
    }),
  ),
  handler: async (ctx, { network }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("customTokens")
      .withIndex("by_user_network", (q) => q.eq("userId", userId).eq("network", network))
      .order("asc")
      .collect();
    return rows.map((t) => ({
      _id: t._id,
      network: t.network,
      contract: t.contract,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
    }));
  },
});

export const insertToken = internalMutation({
  args: {
    userId: v.id("users"),
    network: v.string(),
    contract: v.string(),
    symbol: v.string(),
    name: v.string(),
    decimals: v.number(),
  },
  returns: v.object({
    _id: v.id("customTokens"),
    symbol: v.string(),
    name: v.string(),
    decimals: v.number(),
  }),
  handler: async (ctx, { userId, network, contract, symbol, name, decimals }) => {
    const _id = await ctx.db.insert("customTokens", {
      userId,
      network,
      contract,
      symbol,
      name,
      decimals,
      addedAt: Date.now(),
    });
    return { _id, symbol, name, decimals };
  },
});

export const updateTokenMeta = internalMutation({
  args: {
    tokenId: v.id("customTokens"),
    symbol: v.string(),
    name: v.string(),
    decimals: v.number(),
  },
  returns: v.object({
    _id: v.id("customTokens"),
    symbol: v.string(),
    name: v.string(),
    decimals: v.number(),
  }),
  handler: async (ctx, { tokenId, symbol, name, decimals }) => {
    await ctx.db.patch(tokenId, { symbol, name, decimals });
    return { _id: tokenId, symbol, name, decimals };
  },
});

export const removeToken = mutation({
  args: { tokenId: v.id("customTokens") },
  handler: async (ctx, { tokenId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const token = await ctx.db.get(tokenId);
    if (!token || token.userId !== userId) throw new Error("Token not found");
    await ctx.db.delete(tokenId);
  },
});
