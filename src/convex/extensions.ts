import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** All extension samples the signed-in user has installed. */
export const listInstalled = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("installedExtensions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Install an extension sample (no-op if already installed). */
export const install = mutation({
  args: { sampleId: v.string() },
  handler: async (ctx, { sampleId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const existing = await ctx.db
      .query("installedExtensions")
      .withIndex("by_user_sample", (q) =>
        q.eq("userId", userId).eq("sampleId", sampleId),
      )
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("installedExtensions", {
      userId,
      sampleId,
      enabled: true,
      installedAt: Date.now(),
    });
  },
});

/** Remove an installed extension sample. */
export const remove = mutation({
  args: { sampleId: v.string() },
  handler: async (ctx, { sampleId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const existing = await ctx.db
      .query("installedExtensions")
      .withIndex("by_user_sample", (q) =>
        q.eq("userId", userId).eq("sampleId", sampleId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Enable or disable an installed extension sample. */
export const setEnabled = mutation({
  args: { sampleId: v.string(), enabled: v.boolean() },
  handler: async (ctx, { sampleId, enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const existing = await ctx.db
      .query("installedExtensions")
      .withIndex("by_user_sample", (q) =>
        q.eq("userId", userId).eq("sampleId", sampleId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, { enabled });
  },
});
