import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

/**
 * Persistence for on-chain transactions broadcast by the custodial wallet.
 * Writing happens in a mutation (actions can't touch the DB); the send flow
 * in custodialWallet.ts triggers recordTx via a scheduled internal mutation.
 */

/** List transactions for the signed-in user, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("walletTransactions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Public entry point used by the send actions after a broadcast succeeds. */
export const record = mutation({
  args: {
    accountId: v.id("walletAccounts"),
    hash: v.string(),
    from: v.string(),
    to: v.string(),
    valueWei: v.string(),
    chainId: v.number(),
    chain: v.string(),
    status: v.union(v.literal("pending"), v.literal("confirmed"), v.literal("failed")),
    blockNumber: v.optional(v.number()),
    gasUsedWei: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }

    // Dedupe on hash.
    const existing = await ctx.db
      .query("walletTransactions")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    if (existing.some((t) => t.hash === args.hash)) return;

    await ctx.db.insert("walletTransactions", {
      userId,
      accountId: args.accountId,
      hash: args.hash,
      from: args.from,
      to: args.to,
      valueWei: args.valueWei,
      chainId: args.chainId,
      chain: args.chain,
      status: args.status,
      blockNumber: args.blockNumber,
      gasUsedWei: args.gasUsedWei,
      createdAt: Date.now(),
    });
  },
});

/** Mark a pending transaction as confirmed (called from a status refresh). */
export const markStatus = mutation({
  args: {
    hash: v.string(),
    status: v.union(v.literal("pending"), v.literal("confirmed"), v.literal("failed")),
    blockNumber: v.optional(v.number()),
    gasUsedWei: v.optional(v.string()),
  },
  handler: async (ctx, { hash, status, blockNumber, gasUsedWei }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const rows = await ctx.db
      .query("walletTransactions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = rows.find((t) => t.hash === hash);
    if (!match) return;
    await ctx.db.patch(match._id, { status, blockNumber, gasUsedWei });
  },
});

/** Unused placeholder to keep the internal API surface documented. */
export const _internalNoop = internalMutation({
  args: {},
  handler: async () => {},
});
