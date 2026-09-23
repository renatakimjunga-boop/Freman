import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { Contract, JsonRpcProvider } from "ethers";

interface SavedToken {
  _id: Id<"customTokens">;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * On-chain verification for the user's custom token list.
 *
 * `addToken` reads decimals/symbol/name straight from the ERC-20 contract on
 * public RPC before saving, so typos and fake contracts can't enter the list.
 * Storage lives in `tokenStore.ts` (separate module keeps Convex's generated
 * API types acyclic).
 */

// Must mirror EVM_CHAINS in custodialWallet.ts (same public RPC endpoints).
const EVM_RPCS: Record<string, string[]> = {
  sepolia: [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://rpc.sepolia.org",
    "https://sepolia.drpc.org",
  ],
  mainnet: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
  ],
  polygon: [
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
  ],
  bsc: ["https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
  arbitrum: [
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
  ],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
};

const ERC20_META_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
] as const;

async function providerFor(network: string): Promise<JsonRpcProvider> {
  const rpcs = EVM_RPCS[network];
  if (!rpcs) throw new Error(`Unsupported network: ${network}`);
  let lastError: unknown = new Error("no RPCs configured");
  for (const url of rpcs) {
    try {
      const p = new JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      });
      await p.getNetwork();
      return p;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All public RPCs failed");
}

/** The built-in token contracts (lowercase) — user adds extend this list. */
const BUILTIN_CONTRACTS = new Set([
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x6b175474e89094c44da98b954eedeac495271d0f",
  "0x514910771af9ca656af840dff83e8264ecf986ca",
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  "0x779877a7b0d9e8603169ddbd7836e478b4624339",
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
  "0x55d398326f99059ff775485246999027b3197955",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
]);

/** Verify a contract on-chain and save it to the user's list for the network. */
export const addToken = action({
  args: {
    network: v.string(),
    contract: v.string(),
  },
  returns: v.object({
    _id: v.id("customTokens"),
    symbol: v.string(),
    name: v.string(),
    decimals: v.number(),
  }),
  handler: async (ctx, { network, contract }): Promise<SavedToken> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    if (!EVM_RPCS[network]) throw new Error(`Unsupported network: ${network}`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      throw new Error("Invalid contract address");
    }
    const addr = contract.toLowerCase();
    if (BUILTIN_CONTRACTS.has(addr)) {
      throw new Error("Already in the default token list");
    }

    const provider = await providerFor(network);
    const token = new Contract(contract, ERC20_META_ABI, provider);

    // Read all metadata from chain; a non-token contract (or EOA) throws here.
    const decimals: bigint = await token.decimals();
    const symbol: string = await token.symbol();
    const name: string = await token.name();
    if (!symbol || !name) throw new Error("Contract did not return ERC-20 metadata");
    if (decimals < 0n || decimals > 255n) throw new Error("Invalid token decimals");

    // Upsert by contract address.
    const existing = await ctx.runQuery(api.tokenStore.listForNetwork, { network });
    const dupe = existing.find((t) => t.contract.toLowerCase() === addr);
    if (dupe) {
      return await ctx.runMutation(internal.tokenStore.updateTokenMeta, {
        tokenId: dupe._id,
        symbol,
        name,
        decimals: Number(decimals),
      });
    }

    return await ctx.runMutation(internal.tokenStore.insertToken, {
      userId,
      network,
      contract: addr,
      symbol,
      name,
      decimals: Number(decimals),
    });
  },
});
