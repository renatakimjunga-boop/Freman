import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Bookmarks, shared live between the browser's bookmarks bar and the
 * Studio's Bookmarks section. One bookmark per URL.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("browserBookmarks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Add a bookmark; re-adding an existing URL updates its label. */
export const add = mutation({
  args: { label: v.string(), url: v.string() },
  handler: async (ctx, { label, url }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const existing = await ctx.db
      .query("browserBookmarks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((b) => b.url === url);
    if (match) {
      await ctx.db.patch(match._id, { label: label.trim() || match.label });
      return match._id;
    }

    return await ctx.db.insert("browserBookmarks", {
      userId,
      label: label.trim() || url,
      url,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("browserBookmarks") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const bookmark = await ctx.db.get(id);
    if (!bookmark || bookmark.userId !== userId) {
      throw new Error("Bookmark not found");
    }
    await ctx.db.delete(id);
  },
});
