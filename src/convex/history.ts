import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Browser history. Entries are written by the browser as the user navigates
 * and shown on the browser home page. Newest first.
 */

/** Record a visit; consecutive repeats of the same URL are collapsed. */
export const record = mutation({
  args: { url: v.string(), title: v.string() },
  handler: async (ctx, { url, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;

    const latest = await ctx.db
      .query("browserHistory")
      .withIndex("by_user_visited", (q) =>
        q.eq("userId", userId).gte("visitedAt", Date.now() - 1000 * 60 * 60),
      )
      .order("desc")
      .take(1);

    const last = latest[0];
    if (last && last.url === url && Date.now() - last.visitedAt < 1000 * 60 * 5) {
      await ctx.db.patch(last._id, { visitedAt: Date.now(), title });
      return;
    }
    await ctx.db.insert("browserHistory", {
      userId,
      url,
      title,
      visitedAt: Date.now(),
    });
  },
});

/** The most recent visits, newest first. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("browserHistory")
      .withIndex("by_user_visited", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 12);
  },
});

/** Remove a single entry. */
export const remove = mutation({
  args: { id: v.id("browserHistory") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const entry = await ctx.db.get(id);
    if (!entry || entry.userId !== userId) {
      throw new Error("Entry not found");
    }
    await ctx.db.delete(id);
  },
});

/** Clear all history for the user. */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const entries = await ctx.db
      .query("browserHistory")
      .withIndex("by_user_visited", (q) => q.eq("userId", userId))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
  },
});
