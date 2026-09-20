import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // Extension samples installed by a user into their browser build.
    installedExtensions: defineTable({
      userId: v.id("users"),
      sampleId: v.string(), // slug from the static sample catalog
      enabled: v.boolean(),
      installedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_sample", ["userId", "sampleId"]),

    // Web3 wallet accounts held by the browser's built-in wallet.
    walletAccounts: defineTable({
      userId: v.id("users"),
      address: v.string(), // 0x-prefixed 20-byte hex address
      label: v.string(),
      isPrimary: v.boolean(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Active dApp sessions granted access to a wallet account.
    dappConnections: defineTable({
      userId: v.id("users"),
      origin: v.string(), // e.g. "app.uniswap.org"
      name: v.string(),
      accountId: v.id("walletAccounts"),
      chainId: v.number(),
      connectedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_origin", ["userId", "origin"]),

    // Chromium builds produced from the studio.
    browserBuilds: defineTable({
      userId: v.id("users"),
      channel: v.string(), // Stable | Beta | Dev | Canary
      platform: v.string(),
      chromiumVersion: v.string(),
      revision: v.string(), // short source revision
      status: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
