import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

/**
 * Chrome Web Store publisher connection state.
 *
 * Actions (Node runtime, src/convex/publisher.ts) handle the OAuth token
 * exchange, encryption, uploads and publishes. This module owns the persisted
 * connection row so the Studio can reactively show connection state.
 *
 * The encrypted refresh token is only readable through the INTERNAL query —
 * never through the public API — and writes with an explicit userId are
 * internal mutations, so callers can never touch another user's connection.
 */

/** Minimal shape the Studio needs to render the connection card. */
export const get = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      googleEmail: v.optional(v.string()),
      publisherId: v.optional(v.string()),
      itemCount: v.optional(v.number()),
      connectedAt: v.number(),
      clientId: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const conn = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!conn) return null;
    return {
      googleEmail: conn.googleEmail,
      publisherId: conn.publisherId,
      itemCount: conn.itemCount,
      connectedAt: conn.connectedAt,
      clientId: conn.clientId,
    };
  },
});

/** Full row for same-deployment Node actions. Never exposed publicly. */
export const internalGet = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      encryptedRefreshToken: v.string(),
      clientId: v.string(),
      publisherId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { userId }) => {
    const conn = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!conn) return null;
    return {
      encryptedRefreshToken: conn.encryptedRefreshToken,
      clientId: conn.clientId,
      publisherId: conn.publisherId,
    };
  },
});

/** Store or replace the encrypted refresh token after a completed exchange. */
export const upsertForUser = internalMutation({
  args: {
    userId: v.id("users"),
    encryptedRefreshToken: v.string(),
    clientId: v.string(),
    googleEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    // Preserve the publisher id when it isn't provided anew.
    const publisherId = existing?.publisherId;

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedRefreshToken: args.encryptedRefreshToken,
        clientId: args.clientId,
        googleEmail: args.googleEmail,
        publisherId,
        connectedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("publisherConnections", {
        userId: args.userId,
        encryptedRefreshToken: args.encryptedRefreshToken,
        clientId: args.clientId,
        googleEmail: args.googleEmail,
        publisherId,
        connectedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Update the cached item count after listing items. */
export const setItemCount = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, count }) => {
    const conn = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (conn) await ctx.db.patch(conn._id, { itemCount: count });
    return null;
  },
});

/** Timestamp bump — proves the connection works after a successful refresh. */
export const internalTouch = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const conn = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (conn) await ctx.db.patch(conn._id, { lastUsedAt: Date.now() });
    return null;
  },
});

/** Create a pending OAuth state row (called by the start-connect action). */
export const createPendingState = internalMutation({
  args: {
    state: v.string(),
    verifier: v.string(),
    userId: v.id("users"),
    appOrigin: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("publisherOauthStates", {
      ...args,
      at: Date.now(),
    });
    return null;
  },
});

/** Fetch a pending OAuth state row and delete it (single-use). */
export const consumePendingState = internalMutation({
  args: { state: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      verifier: v.string(),
      userId: v.id("users"),
      appOrigin: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("publisherOauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.at > 10 * 60 * 1000) return null; // expired
    return {
      verifier: row.verifier,
      userId: row.userId,
      appOrigin: row.appOrigin,
    };
  },
});

/** Forget the connection entirely (refresh token is dropped). */
export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const conn = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (conn) await ctx.db.delete(conn._id);
    return null;
  },
});

/** Remember which publisher id the user confirmed in the Studio. */
export const setPublisherId = mutation({
  args: { publisherId: v.string() },
  returns: v.null(),
  handler: async (ctx, { publisherId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first");
    const conn = await ctx.db
      .query("publisherConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (conn) await ctx.db.patch(conn._id, { publisherId });
    return null;
  },
});
