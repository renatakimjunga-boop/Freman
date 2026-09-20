import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const CHROMIUM_VERSIONS = [
  "145.0.7049.0",
  "144.0.7012.3",
  "143.0.6985.2",
  "142.0.6927.1",
];

function randomRevision(): string {
  let revision = "";
  for (let i = 0; i < 12; i++) {
    revision += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  }
  return revision;
}

/** Browser builds produced by the signed-in user, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("browserBuilds")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/** Queue a new Chromium build for the given channel and platform. */
export const create = mutation({
  args: { channel: v.string(), platform: v.string() },
  handler: async (ctx, { channel, platform }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    return await ctx.db.insert("browserBuilds", {
      userId,
      channel,
      platform,
      chromiumVersion:
        CHROMIUM_VERSIONS[Math.floor(Math.random() * CHROMIUM_VERSIONS.length)],
      revision: randomRevision(),
      status: "ready",
      createdAt: Date.now(),
    });
  },
});

/** Remove a build record. */
export const remove = mutation({
  args: { buildId: v.id("browserBuilds") },
  handler: async (ctx, { buildId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const build = await ctx.db.get(buildId);
    if (!build || build.userId !== userId) {
      throw new Error("Build not found");
    }
    await ctx.db.delete(buildId);
  },
});
