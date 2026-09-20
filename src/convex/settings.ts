import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Per-user browser settings. The settings row is created lazily on first
 * write; defaults below match a fresh install.
 */

export const DEFAULTS = {
  theme: "dark" as const,
  searchFilter: "all" as const,
  safeSearch: false,
  saveHistory: true,
  homepage: "freman://home",
  resultsPerPage: "10" as const,
  defaultView: "desktop" as const,
};

export type BrowserSettings = typeof DEFAULTS;

/** Live settings subscription for the signed-in user. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return DEFAULTS;

    const existing = await ctx.db
      .query("browserSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return existing ?? DEFAULTS;
  },
});

/** Patch any subset of settings; the row is created on first write. */
export const update = mutation({
  args: {
    theme: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
    ),
    searchFilter: v.optional(
      v.union(v.literal("all"), v.literal("web3"), v.literal("docs")),
    ),
    safeSearch: v.optional(v.boolean()),
    saveHistory: v.optional(v.boolean()),
    homepage: v.optional(v.string()),
    resultsPerPage: v.optional(
      v.union(v.literal("10"), v.literal("20"), v.literal("30")),
    ),
    defaultView: v.optional(
      v.union(v.literal("desktop"), v.literal("mobile")),
    ),
  },
  handler: async (ctx, patch) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const existing = await ctx.db
      .query("browserSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
      return existing._id;
    }

    return await ctx.db.insert("browserSettings", {
      userId,
      ...DEFAULTS,
      ...patch,
      updatedAt: Date.now(),
    });
  },
});
