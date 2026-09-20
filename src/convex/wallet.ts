import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
 * Insert a custodial account created by the signing action (real keypair,
 * private key already encrypted). First account becomes primary.
 */
export const insertCustodial = mutation({
  args: {
    label: v.string(),
    address: v.string(),
    encryptedPrivateKey: v.string(),
  },
  handler: async (ctx, { label, address, encryptedPrivateKey }) => {
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
      createdAt: Date.now(),
    });
  },
});

/** Create a new wallet account; the first one becomes primary. */
export const createAccount = mutation({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const accounts = await ctx.db
      .query("walletAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return await ctx.db.insert("walletAccounts", {
      userId,
      address: randomAddress(),
      label: label.trim() || `Account ${accounts.length + 1}`,
      isPrimary: accounts.length === 0,
      createdAt: Date.now(),
    });
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
