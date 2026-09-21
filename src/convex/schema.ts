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
    // Custodial: the private key is generated server-side and stored
    // AES-256-GCM encrypted. Rows created before the custodial upgrade have
    // no key material and are receive-only.
    walletAccounts: defineTable({
      userId: v.id("users"),
      address: v.string(), // 0x-prefixed checksummed address
      label: v.string(),
      isPrimary: v.boolean(),
      encryptedPrivateKey: v.optional(v.string()), // v2:iv:tag:ciphertext (hex)
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // On-chain transactions sent from custodial accounts.
    walletTransactions: defineTable({
      userId: v.id("users"),
      accountId: v.id("walletAccounts"),
      hash: v.string(),
      from: v.string(),
      to: v.string(),
      valueWei: v.string(),
      chainId: v.number(),
      chain: v.string(), // "sepolia" | "mainnet"
      status: v.string(), // pending | confirmed | failed
      blockNumber: v.optional(v.number()),
      gasUsedWei: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_account", ["accountId"]),

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

    // Per-user browser settings, edited live from the browser's Settings page.
    browserSettings: defineTable({
      userId: v.id("users"),
      theme: v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
      searchFilter: v.union(v.literal("all"), v.literal("web3"), v.literal("docs")),
      safeSearch: v.boolean(),
      saveHistory: v.boolean(),
      homepage: v.string(),
      resultsPerPage: v.union(v.literal("10"), v.literal("20"), v.literal("30")),
      defaultView: v.union(v.literal("desktop"), v.literal("mobile")),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_updated", ["userId", "updatedAt"]),

    // Visited pages, shown on the browser home page.
    browserHistory: defineTable({
      userId: v.id("users"),
      url: v.string(),
      title: v.string(),
      visitedAt: v.number(),
    })
      .index("by_user_visited", ["userId", "visitedAt"]),

    // Saved bookmarks, shared between the browser's bookmarks bar and Studio.
    publisherOauthStates: defineTable({
      // Opaque state token round-tripped through Google.
      state: v.string(),
      // PKCE verifier kept server-side until the callback exchanges the code.
      verifier: v.string(),
      // The Freman account this connection will bind to.
      userId: v.id("users"),
      // Where to send the user after connecting (Studio origin).
      appOrigin: v.optional(v.string()),
      at: v.number(),
    }).index("by_state", ["state"]),

    publisherConnections: defineTable({
      userId: v.id("users"),
      // Google account identity bound to this connection.
      googleEmail: v.optional(v.string()),
      // OAuth client used (so credentials can be rotated safely).
      clientId: v.string(),
      publisherId: v.optional(v.string()),
      // AES-256-GCM blob (WALLET_ENCRYPTION_KEY): v2:iv:tag:ciphertext
      encryptedRefreshToken: v.string(),
      // Denormalized item count shown in the Studio.
      itemCount: v.optional(v.number()),
      connectedAt: v.number(),
      lastUsedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    browserBookmarks: defineTable({
      userId: v.id("users"),
      label: v.string(),
      url: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
