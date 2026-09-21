import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

const HEX = "0123456789abcdef";

function randomAddress(): string {
  let address = "0x";
  for (let i = 0; i < 40; i++) {
    address += HEX[Math.floor(Math.random() * HEX.length)];
  }
  return address;
}

/** Wallet accounts owned by the signed-in user. */
export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("walletAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Internal: hand the encrypted key material to the custodial signing action,
 * only for accounts owned by the caller. Never exposed to the client.
 */
export const getForSigning = query({
  args: { accountId: v.id("walletAccounts") },
  handler: async (ctx, { accountId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const account = await ctx.db.get(accountId);
    if (!account || account.userId !== userId) return null;
    return account;
  },
});

/** Active dApp sessions for the signed-in user. */
export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("dappConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Insert a custodial account created by the signing action. Multi-chain rows
 * carry a chainType + derivation index (key derived from the vault seed);
 * legacy rows carry their own encrypted private key.
 */
export const insertCustodial = mutation({
  args: {
    label: v.string(),
    address: v.string(),
    encryptedPrivateKey: v.optional(v.string()),
    chainType: v.optional(
      v.union(v.literal("evm"), v.literal("solana"), v.literal("tron")),
    ),
    derivationIndex: v.optional(v.number()),
  },
  handler: async (ctx, { label, address, encryptedPrivateKey, chainType, derivationIndex }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const accounts = await ctx.db
      .query("walletAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return await ctx.db.insert("walletAccounts", {
      userId,
      address,
      label: label.trim() || `Account ${accounts.length + 1}`,
      isPrimary: accounts.length === 0,
      encryptedPrivateKey,
      chainType,
      derivationIndex,
      createdAt: Date.now(),
    });
  },
});

/** Internal: the user's encrypted master seed (vault), or null. */
export const getVaultForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { userId }) => {
    const vault = await ctx.db
      .query("walletVaults")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return vault?.encryptedSeed ?? null;
  },
});

/** Internal: create the vault row (first account creation only). */
export const insertVault = internalMutation({
  args: { userId: v.id("users"), encryptedSeed: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, encryptedSeed }) => {
    const existing = await ctx.db
      .query("walletVaults")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return null;
    await ctx.db.insert("walletVaults", {
      userId,
      encryptedSeed,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Remove an account and any dApp sessions using it. */
export const removeAccount = mutation({
  args: { accountId: v.id("walletAccounts") },
  handler: async (ctx, { accountId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const account = await ctx.db.get(accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }

    const connections = await ctx.db
      .query("dappConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const connection of connections) {
      if (connection.accountId === accountId) {
        await ctx.db.delete(connection._id);
      }
    }

    await ctx.db.delete(accountId);

    if (account.isPrimary) {
      const rest = await ctx.db
        .query("walletAccounts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      if (rest.length > 0) {
        await ctx.db.patch(rest[0]._id, { isPrimary: true });
      }
    }
  },
});

/** Promote an account to primary. */
export const setPrimary = mutation({
  args: { accountId: v.id("walletAccounts") },
  handler: async (ctx, { accountId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const account = await ctx.db.get(accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }

    const accounts = await ctx.db
      .query("walletAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const other of accounts) {
      if (other.isPrimary) await ctx.db.patch(other._id, { isPrimary: false });
    }
    await ctx.db.patch(accountId, { isPrimary: true });
  },
});

/** Connect a dApp to a wallet account (one session per origin). */
export const connectDapp = mutation({
  args: {
    origin: v.string(),
    name: v.string(),
    accountId: v.id("walletAccounts"),
    chainId: v.number(),
  },
  handler: async (ctx, { origin, name, accountId, chainId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const account = await ctx.db.get(accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }

    const existing = await ctx.db
      .query("dappConnections")
      .withIndex("by_user_origin", (q) =>
        q.eq("userId", userId).eq("origin", origin),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accountId,
        chainId,
        connectedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("dappConnections", {
      userId,
      origin,
      name,
      accountId,
      chainId,
      connectedAt: Date.now(),
    });
  },
});

/** Disconnect a dApp session. */
export const disconnectDapp = mutation({
  args: { connectionId: v.id("dappConnections") },
  handler: async (ctx, { connectionId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const connection = await ctx.db.get(connectionId);
    if (!connection || connection.userId !== userId) {
      throw new Error("Connection not found");
    }
    await ctx.db.delete(connectionId);
  },
});
