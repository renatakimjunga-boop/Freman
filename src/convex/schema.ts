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
      // For catalog samples: the sample slug. For Chrome Web Store installs:
      // "cws:<storeId>".
      sampleId: v.string(),
      enabled: v.boolean(),
      installedAt: v.number(),
      // Display metadata (store installs have no static catalog entry).
      name: v.optional(v.string()),
      iconUrl: v.optional(v.string()),
      // "sample" (default) or "store".
      kind: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_user_sample", ["userId", "sampleId"]),

    // Web3 wallet accounts held by the browser's built-in wallet.
    // Custodial: keys are derived server-side from an encrypted master seed
    // (BIP-44 for EVM/Tron, SLIP-0010 for Solana). Rows created before the
    // multi-chain upgrade carry a per-account encrypted key and chainType
    // "evm" by definition.
    walletAccounts: defineTable({
      userId: v.id("users"),
      address: v.string(),
      label: v.string(),
      isPrimary: v.boolean(),
      // "evm" | "solana" | "tron" (absent on legacy rows = evm)
      chainType: v.optional(
        v.union(v.literal("evm"), v.literal("solana"), v.literal("tron")),
      ),
      // BIP-44 account index within its chain family.
      derivationIndex: v.optional(v.number()),
      // Legacy rows only: v2:iv:tag:ciphertext (hex)
      encryptedPrivateKey: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // On-chain transactions sent from custodial accounts.
    walletTransactions: defineTable({
      userId: v.id("users"),
      accountId: v.id("walletAccounts"),
      hash: v.string(),
      from: v.string(),
      to: v.string(),
      valueWei: v.string(), // smallest unit (wei / lamports / sun)
      chainId: v.number(), // EVM id; 0 for non-EVM chains
      chain: v.string(), // "sepolia" | "mainnet" | "solana:devnet" | "tron:mainnet" | ...
      status: v.string(), // pending | confirmed | failed
      blockNumber: v.optional(v.number()),
      gasUsedWei: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_account", ["accountId"])
      .index("by_account_hash", ["accountId", "hash"]),

    // User-added ERC-20 tokens per network, verified on-chain at add time.
    // Extends the built-in known-token list in the wallet UI.
    customTokens: defineTable({
      userId: v.id("users"),
      network: v.string(), // EVM network id ("mainnet", "base", ...)
      contract: v.string(), // token contract address
      symbol: v.string(),
      name: v.string(),
      decimals: v.number(),
      addedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_network", ["userId", "network"]),

    // Encrypted master seed for the multi-chain custodial wallet. One per
    // user; all account keys are derived from it and never stored raw.
    walletVaults: defineTable({
      userId: v.id("users"),
      // AES-256-GCM blob (WALLET_ENCRYPTION_KEY): v2:iv:tag:ciphertext
      encryptedSeed: v.string(),
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

    // Per-user browser settings, edited live from the browser's Settings page.
    browserSettings: defineTable({
      userId: v.id("users"),
      theme: v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
      searchEngine: v.union(v.literal("freman"), v.literal("google")),
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
