"use node";

import crypto from "crypto";
import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  Wallet as EvmWallet,
  HDNodeWallet,
  JsonRpcProvider,
  Contract,
  parseEther,
  formatEther,
  formatUnits,
} from "ethers";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { keccak_256 } from "@noble/hashes/sha3";
import { hmac } from "@noble/hashes/hmac";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";

/**
 * Multi-chain custodial wallet core for Freman's built-in wallet.
 *
 * - One master seed per user, generated server-side and encrypted at rest
 *   with AES-256-GCM (WALLET_ENCRYPTION_KEY). The raw seed is never stored.
 * - EVM + Tron keys derive BIP-44 (coin 60 / 195); Solana keys derive
 *   SLIP-0010 ed25519 (coin 501) — all from the same master seed.
 * - Balances are read live from public RPC endpoints; transactions are
 *   signed server-side and broadcast raw.
 * - Mainnet sends (any chain) require `confirmed: true` — the client must
 *   show a real-value warning first.
 */

/* ------------------------------- encryption ------------------------------- */

function encryptionKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "WALLET_ENCRYPTION_KEY is not set (32-byte hex string required)",
    );
  }
  return Buffer.from(hex, "hex");
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

function decryptSecret(blob: string): string {
  const [version, ivHex, tagHex, dataHex] = blob.split(":");
  if (version !== "v2") throw new Error("Unsupported encryption version");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/* ------------------------------ base58 (Tron / Solana) ----------------------------- */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const hex = Buffer.from(bytes).toString("hex");
  let n = hex ? BigInt(`0x${hex}`) : 0n;
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
  return "1".repeat(zeros) + out;
}

function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const idx = B58.indexOf(c);
    if (idx < 0) throw new Error("Invalid base58 character");
    n = n * 58n + BigInt(idx);
  }
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  let zeros = 0;
  for (const c of s) {
    if (c !== "1") break;
    zeros++;
  }
  if (zeros > 0) bytes = Buffer.concat([Buffer.alloc(zeros), bytes]);
  return new Uint8Array(bytes);
}

/** Base58Check: payload + first 4 bytes of sha256(sha256(payload)). */
function base58CheckEncode(payload: Uint8Array): string {
  const hash = sha256(sha256(payload));
  const withChecksum = new Uint8Array(payload.length + 4);
  withChecksum.set(payload, 0);
  withChecksum.set(hash.slice(0, 4), payload.length);
  return base58Encode(withChecksum);
}

/** Decode a base58check string, verifying its checksum and 0x41 prefix. */
function tronBase58ToHex(address: string): string {
  const decoded = base58Decode(address);
  if (decoded.length !== 25) throw new Error("Invalid Tron address");
  const payload = decoded.slice(0, 21);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const expected = decoded.slice(21);
  if (Buffer.compare(Buffer.from(checksum), Buffer.from(expected)) !== 0) {
    throw new Error("Invalid Tron address checksum");
  }
  if (payload[0] !== 0x41) throw new Error("Not a Tron mainnet address");
  return Buffer.from(payload).toString("hex");
}

/* ------------------------------- key derivation ------------------------------- */

/**
 * SLIP-0010 ed25519 private-key derivation (all-hardened path) from a seed.
 * Returns the 32-byte ed25519 private key at `path` (each segment hardened).
 */
function slip10Ed25519(seed: Buffer, path: number[]): Buffer {
  const i0 = hmac.create(sha512, "ed25519 seed").update(seed).digest();
  let key = Buffer.from(i0.slice(0, 32));
  let chainCode = Buffer.from(i0.slice(32));
  for (const segment of path) {
    const data = Buffer.alloc(1 + 32 + 4);
    key.copy(data, 1);
    data.writeUInt32BE((segment + 0x80000000) >>> 0, 33);
    const i = hmac.create(sha512, chainCode).update(data).digest();
    key = Buffer.from(i.slice(0, 32));
    chainCode = Buffer.from(i.slice(32));
  }
  return key;
}

/** BIP-44 EVM account: m/44'/60'/0'/0/index → { address, privateKey }. */
function deriveEvm(seed: Buffer, index: number) {
  const hd = HDNodeWallet.fromSeed(seed).derivePath(`m/44'/60'/0'/0/${index}`);
  return { address: hd.address, privateKey: hd.privateKey };
}

/**
 * BIP-44 Tron account: m/44'/195'/0'/0/index → base58check T-address plus
 * the hex form the Tron API expects (0x41-prefixed h160).
 */
function deriveTron(seed: Buffer, index: number) {
  const hd = HDNodeWallet.fromSeed(seed).derivePath(`m/44'/195'/0'/0/${index}`);
  const compressed = hd.signingKey.compressedPublicKey; // 0x-prefixed 33-byte hex
  const hash = keccak_256(Buffer.from(compressed.slice(2), "hex"));
  const h160 = hash.subarray(12); // last 20 bytes — Ethereum-style address body
  const payload = Buffer.alloc(21);
  payload[0] = 0x41; // Tron mainnet prefix
  Buffer.from(h160).copy(payload, 1);
  return {
    address: base58CheckEncode(new Uint8Array(payload)),
    addressHex: Buffer.from(payload).toString("hex"),
    privateKey: hd.privateKey,
  };
}

/** SLIP-0010 Solana account: m/44'/501'/index'/0' → base58 pubkey. */
function deriveSolana(seed: Buffer, index: number) {
  const privateKey = slip10Ed25519(seed, [44, 501, index, 0]);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { address: base58Encode(publicKey), privateKey };
}

/** Load (or create) the user's encrypted master seed. */
async function masterSeed(ctx: ActionCtx, userId: Id<"users">): Promise<Buffer> {
  const encrypted = await ctx.runQuery(internal.wallet.getVaultForUser, { userId });
  if (encrypted) return Buffer.from(decryptSecret(encrypted), "hex");
  const seed = crypto.randomBytes(32).toString("hex");
  await ctx.runMutation(internal.wallet.insertVault, {
    userId,
    encryptedSeed: encryptSecret(seed),
  });
  return Buffer.from(seed, "hex");
}

/* --------------------------------- chains --------------------------------- */

interface EvmChain {
  name: string;
  chainId: number;
  symbol: string;
  rpcs: string[];
  explorer: string;
  testnet?: boolean;
}

export const EVM_CHAINS: Record<string, EvmChain> = {
  sepolia: {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    symbol: "ETH",
    rpcs: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.org",
      "https://1rpc.io/sepolia",
    ],
    explorer: "https://sepolia.etherscan.io",
    testnet: true,
  },
  mainnet: {
    name: "Ethereum",
    chainId: 1,
    symbol: "ETH",
    rpcs: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://cloudflare-eth.com",
    ],
    explorer: "https://etherscan.io",
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    symbol: "POL",
    rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://rpc.ankr.com/polygon"],
    explorer: "https://polygonscan.com",
  },
  bsc: {
    name: "BNB Smart Chain",
    chainId: 56,
    symbol: "BNB",
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"],
    explorer: "https://bscscan.com",
  },
  arbitrum: {
    name: "Arbitrum One",
    chainId: 42161,
    symbol: "ETH",
    rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    explorer: "https://arbiscan.io",
  },
  base: {
    name: "Base",
    chainId: 8453,
    symbol: "ETH",
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    explorer: "https://basescan.org",
  },
};

export const SOLANA_NETWORKS: Record<
  string,
  { name: string; endpoint: string; explorer: string; testnet?: boolean }
> = {
  "solana:devnet": {
    name: "Solana Devnet",
    endpoint: "https://api.devnet.solana.com",
    explorer: "https://explorer.solana.com/tx/$TX?cluster=devnet",
    testnet: true,
  },
  "solana:mainnet": {
    name: "Solana",
    endpoint: "https://api.mainnet-beta.solana.com",
    explorer: "https://explorer.solana.com/tx/$TX",
  },
};

export const TRON_NETWORKS: Record<
  string,
  { name: string; endpoint: string; explorer: string; testnet?: boolean }
> = {
  "tron:mainnet": {
    name: "Tron",
    endpoint: "https://api.trongrid.io",
    explorer: "https://tronscan.org/#/transaction/$TX",
  },
  "tron:nile": {
    name: "Tron Nile (test)",
    endpoint: "https://nile.trongrid.io",
    explorer: "https://nile.tronscan.org/#/transaction/$TX",
    testnet: true,
  },
};

async function evmProvider(chain: EvmChain): Promise<JsonRpcProvider> {
  let lastError: unknown = new Error("no RPCs configured");
  for (const url of chain.rpcs) {
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

async function solanaRpc<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    result?: T;
  };
  if (json.error) throw new Error(json.error.message ?? "Solana RPC error");
  return json.result as T;
}

async function tronApi(
  endpoint: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tron API ${path} failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

/* ------------------------------ persistence glue ------------------------------ */

interface Broadcast {
  hash: string;
  from: string;
  to: string;
  valueRaw: string;
  status: "pending" | "confirmed";
  explorerUrl: string;
  blockNumber?: number;
  gasUsed?: string;
}

async function finish(
  ctx: ActionCtx,
  args: Broadcast & {
    accountId: Id<"walletAccounts">;
    userId: Id<"users">;
    network: string;
    chainType: "evm" | "solana" | "tron";
  },
): Promise<SendResult> {
  const { accountId, userId, network, chainType, ...broadcast } = args;
  const chainId = chainType === "evm" ? EVM_CHAINS[network]?.chainId ?? 0 : 0;
  await ctx.runMutation(api.transactions.record, {
    accountId,
    hash: broadcast.hash,
    from: broadcast.from,
    to: broadcast.to,
    valueWei: broadcast.valueRaw,
    chainId,
    chain: network,
    status: broadcast.status,
    blockNumber: broadcast.blockNumber,
    gasUsedWei: broadcast.gasUsed,
  });
  return {
    hash: broadcast.hash,
    from: broadcast.from,
    to: broadcast.to,
    valueRaw: broadcast.valueRaw,
    network,
    chainType,
    status: broadcast.status,
    explorerUrl: broadcast.explorerUrl,
  };
}

export interface SendResult {
  hash: string;
  from: string;
  to: string;
  valueRaw: string;
  network: string;
  chainType: "evm" | "solana" | "tron";
  status: "pending" | "confirmed";
  explorerUrl: string;
}

/* --------------------------------- actions -------------------------------- */

type ChainType = "evm" | "solana" | "tron";

/** Shared creation logic for both the multi-chain and legacy entry points. */
async function createAccountForUser(
  ctx: ActionCtx,
  label: string,
  chainType: ChainType,
): Promise<{ accountId: string; address: string; chainType: string }> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not signed in");

  const seed = await masterSeed(ctx, userId);
  const existing = (await ctx.runQuery(api.wallet.listAccounts)) as Array<{
    chainType?: string;
    derivationIndex?: number;
  }>;
  const usedIndexes = new Set(
    existing
      .filter((a) => (a.chainType ?? "evm") === chainType)
      .map((a) => a.derivationIndex ?? 0),
  );
  let index = 0;
  while (usedIndexes.has(index)) index++;

  const derived =
    chainType === "solana"
      ? deriveSolana(seed, index)
      : chainType === "tron"
        ? deriveTron(seed, index)
        : deriveEvm(seed, index);

  const accountId = await ctx.runMutation(api.wallet.insertCustodial, {
    label: label.trim() || `Account ${existing.length + 1}`,
    address: derived.address,
    chainType,
    derivationIndex: index,
  });

  return { accountId, address: derived.address, chainType };
}

/**
 * Create a custodial account on any supported chain family. The key is
 * derived from the user's encrypted master seed at the next free index and
 * never stored raw.
 */
export const createAccount = action({
  args: {
    label: v.string(),
    chainType: v.union(v.literal("evm"), v.literal("solana"), v.literal("tron")),
  },
  returns: v.object({
    accountId: v.string(),
    address: v.string(),
    chainType: v.string(),
  }),
  handler: async (
    ctx,
    { label, chainType },
  ): Promise<{ accountId: string; address: string; chainType: string }> =>
    createAccountForUser(ctx, label, chainType),
});

/**
 * Legacy EVM-only creation entry point (kept so older clients keep working);
 * new code should call createAccount with an explicit chainType.
 */
export const createCustodialAccount = action({
  args: { label: v.string() },
  returns: v.object({
    accountId: v.string(),
    address: v.string(),
    chainType: v.string(),
  }),
  handler: async (ctx, { label }) =>
    createAccountForUser(ctx, label, "evm"),
});

/** Live native balance for an account (or any address) on a network. */
export const getBalance = action({
  args: {
    address: v.optional(v.string()),
    accountId: v.optional(v.id("walletAccounts")),
    network: v.optional(v.string()),
    // Legacy alias for `network` (older clients pass chain: "sepolia").
    chain: v.optional(v.string()),
  },
  returns: v.object({
    network: v.string(),
    chainType: v.string(),
    symbol: v.string(),
    raw: v.string(),
    formatted: v.string(),
    // Legacy alias for `formatted` (older clients read balanceEth).
    balanceEth: v.string(),
  }),
  handler: async (
    ctx,
    { address, accountId, network: networkArg, chain },
  ): Promise<{
    network: string;
    chainType: string;
    symbol: string;
    raw: string;
    formatted: string;
    balanceEth: string;
  }> => {
    let addr = address;
    let accountChainType: ChainType | undefined;
    let accountRow: {
      address: string;
      chainType?: string;
    } | null = null;
    if (accountId) {
      const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
      if (account) {
        accountRow = account;
        accountChainType = (account.chainType as ChainType | undefined) ?? "evm";
        if (!addr) addr = account.address;
      }
    }
    if (!addr) throw new Error("Address or accountId required");

    // Explicit network wins; else fall back to the account's family default.
    const network =
      networkArg ??
      chain ??
      (accountChainType === "solana"
        ? "solana:devnet"
        : accountChainType === "tron"
          ? "tron:nile"
          : "sepolia");
    void accountRow;

    if (network.startsWith("solana:")) {
      const net = SOLANA_NETWORKS[network];
      if (!net) throw new Error(`Unknown network: ${network}`);
      const result = await solanaRpc<{ value: number }>(net.endpoint, "getBalance", [
        addr,
      ]);
      const lamports = result?.value ?? 0;
      return {
        network,
        chainType: "solana",
        symbol: "SOL",
        raw: String(lamports),
        formatted: (lamports / 1_000_000_000).toFixed(9),
        balanceEth: (lamports / 1_000_000_000).toFixed(9),
      };
    }

    if (network.startsWith("tron:")) {
      const net = TRON_NETWORKS[network] ?? TRON_NETWORKS["tron:mainnet"];
      const account = await tronApi(net.endpoint, "/wallet/getaccount", {
        address: addr,
        visible: true,
      });
      const sun = typeof account.balance === "number" ? account.balance : 0;
      return {
        network,
        chainType: "tron",
        symbol: "TRX",
        raw: String(sun),
        formatted: (sun / 1_000_000).toFixed(6),
        balanceEth: (sun / 1_000_000).toFixed(6),
      };
    }

    const evmChain = EVM_CHAINS[network] ?? EVM_CHAINS["sepolia"];
    void accountChainType;
    const provider = await evmProvider(evmChain);
    const wei = await provider.getBalance(addr);
    return {
      network,
      chainType: "evm",
      symbol: evmChain.symbol,
      raw: wei.toString(),
      formatted: formatEther(wei),
      balanceEth: formatEther(wei),
    };
  },
});

/* ------------------------------- token balances ------------------------------- */

/** Well-known token contracts per network, verified against official docs. */
const KNOWN_TOKENS: Record<string, Array<{ symbol: string; name: string; address: string; decimals: number }>> = {
  mainnet: [
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
    { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
    { symbol: "SHIB", name: "Shiba Inu", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18 },
  ],
  sepolia: [
    { symbol: "USDC", name: "USD Coin", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
    { symbol: "LINK", name: "Chainlink", address: "0x779877A7B0D9E8603169DdbD7836e478b4624339", decimals: 18 },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
  ],
  polygon: [
    { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
  ],
  bsc: [
    { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  ],
  arbitrum: [
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  ],
  base: [
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  ],
  "solana:devnet": [
    { symbol: "USDC", name: "USD Coin", address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6 },
  ],
  "solana:mainnet": [
    { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  ],
};

/** ABI-encode a Tron address (0x41-prefixed h160) as a 32-byte parameter. */
function tronAddressParam(address: string): string {
  return tronBase58ToHex(address).padStart(64, "0");
}

/**
 * Read ERC-20 / SPL / TRC-20 token balances for an address in one call —
 * all data straight from chain via public RPC, nothing cached or mocked.
 */
export const getTokenBalances = action({
  args: {
    address: v.string(),
    network: v.optional(v.string()),
    accountId: v.optional(v.id("walletAccounts")),
  },
  returns: v.array(
    v.object({
      symbol: v.string(),
      name: v.string(),
      contract: v.string(),
      raw: v.string(),
      formatted: v.string(),
    }),
  ),
  handler: async (ctx, { address, network: networkArg, accountId }): Promise<Array<{ symbol: string; name: string; contract: string; raw: string; formatted: string }>> => {
    let net = networkArg;
    if (!net && accountId) {
      const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
      if (account) {
        const t = (account.chainType as ChainType | undefined) ?? "evm";
        net = t === "solana" ? "solana:devnet" : t === "tron" ? "tron:nile" : "sepolia";
      }
    }
    const network = net ?? "sepolia";

    // Tron: TRC-20 balances via the official constant-call REST API.
    if (network.startsWith("tron:")) {
      const endpoint = TRON_NETWORKS[network]?.endpoint ?? TRON_NETWORKS["tron:mainnet"].endpoint;
      const trc20: Array<{ symbol: string; name: string; contract: string; raw: string; formatted: string }> = [];
      // Well-known TRC-20s on Tron (mainnet + Nile testnet both list USDT/USDC).
      const tronTokens =
        network === "tron:nile"
          ? []
          : [
              { symbol: "USDT", name: "Tether USD", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
              { symbol: "USDC", name: "USD Coin", address: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6 },
            ];
      for (const token of tronTokens) {
        try {
          const res = await tronApi(endpoint, "/wallet/triggerconstantcontract", {
            owner_address: address,
            function_selector: "balanceOf(address)",
            parameter: tronAddressParam(address),
            contract_address: token.address,
            visible: true,
          });
          const hex = (res.constant_result as string[] | undefined)?.[0];
          const raw = hex ? BigInt(`0x${hex}`) : 0n;
          if (raw > 0n) {
            trc20.push({
              symbol: token.symbol,
              name: token.name,
              contract: token.address,
              raw: raw.toString(),
              formatted: formatUnits(raw, token.decimals),
            });
          }
        } catch {
          // Token probe failed — omit rather than break the list.
        }
      }
      return trc20;
    }

    // Solana: SPL token accounts for the well-known USDC mint.
    if (network.startsWith("solana:")) {
      const endpoint = SOLANA_NETWORKS[network]?.endpoint ?? SOLANA_NETWORKS["solana:mainnet"].endpoint;
      const mints = KNOWN_TOKENS[network] ?? [];
      const out: Array<{ symbol: string; name: string; contract: string; raw: string; formatted: string }> = [];
      for (const mint of mints) {
        try {
          const res = await solanaRpc<{
            value: Array<{
              account: {
                data: {
                  parsed: {
                    info: {
                      tokenAmount: { uiAmountString: string; amount: string };
                    };
                  };
                };
              };
            }>;
          }>(
            endpoint,
            "getTokenAccountsByOwner",
            [address, { mint: mint.address }, { encoding: "jsonParsed" }],
          );
          const total = (res.value ?? []).reduce(
            (sum, entry) =>
              sum + BigInt(entry.account.data.parsed.info.tokenAmount.amount || "0"),
            0n,
          );
          if (total > 0n) {
            out.push({
              symbol: mint.symbol,
              name: mint.name,
              contract: mint.address,
              raw: total.toString(),
              formatted: formatUnits(total, mint.decimals),
            });
          }
        } catch {
          // Skip mints that fail — a missing account is not an error.
        }
      }
      return out;
    }

    // EVM: multicall-style reads over the well-known token list.
    const evmChain = EVM_CHAINS[network] ?? EVM_CHAINS["sepolia"];
    const provider = await evmProvider(evmChain);
    const tokens = KNOWN_TOKENS[network] ?? [];
    const erc20Abi = [
      "function balanceOf(address owner) view returns (uint256)",
    ] as const;
    const out: Array<{ symbol: string; name: string; contract: string; raw: string; formatted: string }> = [];
    await Promise.all(
      tokens.map(async (token) => {
        try {
          const contract = new Contract(token.address, erc20Abi, provider);
          const raw: bigint = await contract.balanceOf(address);
          if (raw > 0n) {
            out.push({
              symbol: token.symbol,
              name: token.name,
              contract: token.address,
              raw: raw.toString(),
              formatted: formatUnits(raw, token.decimals),
            });
          }
        } catch {
          // Token probe failed (RPC hiccup) — omit rather than break the list.
        }
      }),
    );
    return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

/**
 * Send a native-asset transaction from a custodial account on any chain.
 * Mainnet networks require `confirmed: true` — the client must show a
 * real-value warning first.
 */
export const sendTransaction = action({
  args: {
    accountId: v.id("walletAccounts"),
    to: v.string(),
    amount: v.optional(v.string()), // decimal, human units (ETH / SOL / TRX)
    network: v.optional(v.string()),
    // Legacy aliases (older clients send EVM transactions with these).
    amountEth: v.optional(v.string()),
    chain: v.optional(v.string()),
    confirmed: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (
    ctx,
    { accountId, to, amount: amountArg, network: networkArg, amountEth, chain, confirmed },
  ): Promise<SendResult> => {
    const amount = amountArg ?? amountEth;
    if (!amount) throw new Error("Amount required");
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
    if (!account) throw new Error("Account not found");
    const accountChainType = (account.chainType as ChainType | undefined) ?? "evm";

    const network = networkArg ?? chain ?? "sepolia";

    if (network.startsWith("solana:")) {
      const net = SOLANA_NETWORKS[network];
      if (!net) throw new Error(`Unknown network: ${network}`);
      if (accountChainType !== "solana") {
        throw new Error("This account is not a Solana account");
      }
      if (!net.testnet && confirmed !== true) {
        throw new Error("Mainnet sends move real funds and must be explicitly confirmed.");
      }
      const seed = await masterSeed(ctx, userId);
      const broadcast = await sendSolana(
        seed,
        account.derivationIndex ?? 0,
        account.address,
        to,
        amount,
        net.endpoint,
        net.explorer,
      );
      return finish(ctx, {
        accountId,
        userId,
        ...broadcast,
        network,
        chainType: "solana",
      });
    }

    if (network.startsWith("tron:")) {
      const net = TRON_NETWORKS[network];
      if (!net) throw new Error(`Unknown network: ${network}`);
      if (accountChainType !== "tron") {
        throw new Error("This account is not a Tron account");
      }
      if (!net.testnet && confirmed !== true) {
        throw new Error("Mainnet sends move real funds and must be explicitly confirmed.");
      }
      const seed = await masterSeed(ctx, userId);
      const broadcast = await sendTron(
        seed,
        account.derivationIndex ?? 0,
        account.address,
        to,
        amount,
        net.endpoint,
        net.explorer,
      );
      return finish(ctx, {
        accountId,
        userId,
        ...broadcast,
        network,
        chainType: "tron",
      });
    }

    const evmChain = EVM_CHAINS[network];
    if (!evmChain) throw new Error(`Unknown network: ${network}`);
    if (accountChainType !== "evm") {
      throw new Error("This account is not an EVM account");
    }
    if (!evmChain.testnet && confirmed !== true) {
      throw new Error("Mainnet sends move real funds and must be explicitly confirmed.");
    }

    let privateKey: string;
    if (account.encryptedPrivateKey) {
      // Legacy pre-vault account: sign with its own stored key.
      privateKey = decryptSecret(account.encryptedPrivateKey);
    } else {
      const seed = await masterSeed(ctx, userId);
      privateKey = deriveEvm(seed, account.derivationIndex ?? 0).privateKey;
    }

    const provider = await evmProvider(evmChain);
    const signer = new EvmWallet(privateKey, provider);
    if (signer.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("Stored key does not match this account");
    }
    const value = parseEther(amount);
    if (value <= 0n) throw new Error("Amount must be positive");
    const tx = await signer.sendTransaction({ to, value });
    const receipt = await tx.wait();

    return finish(ctx, {
      accountId,
      userId,
      hash: tx.hash,
      from: account.address,
      to,
      valueRaw: value.toString(),
      status: receipt ? ("confirmed" as const) : ("pending" as const),
      network,
      chainType: "evm",
      explorerUrl: `${evmChain.explorer}/tx/${tx.hash}`,
      blockNumber: receipt?.blockNumber,
      gasUsed: receipt?.gasUsed?.toString(),
    });
  },
});

/* ------------------------------ chain senders ------------------------------ */

/** Compact-u16 (short) serialization used throughout Solana messages. */
function compactU16(n: number): number[] {
  const out: number[] = [];
  let v = n;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(byte);
      break;
    }
    byte |= 0x80;
    out.push(byte);
  }
  return out;
}

const SOLANA_SYSTEM_PROGRAM = new Uint8Array(32).fill(0); // base58 all-1s program id

/**
 * Build + sign a legacy Solana SOL transfer (no SDK dependency) and broadcast
 * it. Returns the standard Broadcast shape for the persistence glue.
 */
async function sendSolana(
  seed: Buffer,
  derivationIndex: number,
  fromAddress: string,
  to: string,
  amount: string,
  endpoint: string,
  explorerTemplate: string,
): Promise<Broadcast> {
  const { privateKey } = deriveSolana(seed, derivationIndex);
  const fromPub = ed25519.getPublicKey(privateKey);
  if (base58Encode(fromPub) !== fromAddress) {
    throw new Error("Derived key does not match this account");
  }
  const toPub = base58Decode(to);
  if (toPub.length !== 32) throw new Error("Invalid Solana recipient address");
  const lamports = BigInt((Number(amount) * 1_000_000_000).toFixed(0));
  if (lamports <= 0n) throw new Error("Amount must be positive");

  const blockhash = await solanaRpc<{ value: { blockhash: string } }>(
    endpoint,
    "getLatestBlockhash",
    [{ commitment: "finalized" }],
  );
  const recent = base58Decode(blockhash.value.blockhash);

  // Message: header + accounts + blockhash + one SystemProgram::Transfer.
  const message: number[] = [];
  message.push(1, 0, 1); // signatures required / readonly signed / readonly unsigned
  message.push(...compactU16(3)); // account keys
  message.push(...fromPub, ...toPub, ...SOLANA_SYSTEM_PROGRAM);
  message.push(...recent);
  message.push(...compactU16(1)); // instructions
  message.push(2); // programIdIndex = system program
  message.push(...compactU16(2), 0, 1); // accounts = [from, to]
  const data = [2]; // SystemInstruction::Transfer
  for (let i = 0; i < 8; i++) {
    data.push(Number((lamports >> BigInt(8 * i)) & 0xffn));
  }
  message.push(...compactU16(data.length), ...data);

  const msgBytes = Uint8Array.from(message);
  const signature = ed25519.sign(msgBytes, privateKey);

  // Wire: signatures vector + message. Base64 avoids base58 ambiguity.
  const wire = new Uint8Array(1 + 64 + msgBytes.length);
  wire[0] = 1; // signature count
  wire.set(signature, 1);
  wire.set(msgBytes, 65);

  const result = await solanaRpc<string>(endpoint, "sendTransaction", [
    Buffer.from(wire).toString("base64"),
    { encoding: "base64", skipPreflight: false },
  ]);
  const hash = typeof result === "string" ? result : base58Encode(signature);
  return {
    hash,
    from: fromAddress,
    to,
    valueRaw: lamports.toString(),
    status: "pending",
    explorerUrl: explorerTemplate.replace("$TX", hash),
  };
}

/**
 * Build + sign a Tron TRX transfer against the Tron REST API. The API builds
 * the raw transaction; signing is secp256k1 over sha256(raw_data_hex).
 */
async function sendTron(
  seed: Buffer,
  derivationIndex: number,
  fromAddress: string,
  to: string,
  amount: string,
  endpoint: string,
  explorerTemplate: string,
): Promise<Broadcast> {
  const { privateKey, addressHex } = deriveTron(seed, derivationIndex);
  if (addressHex !== tronBase58ToHex(fromAddress)) {
    throw new Error("Derived key does not match this account");
  }
  const toHex = tronBase58ToHex(to);
  const sun = BigInt((Number(amount) * 1_000_000).toFixed(0));
  if (sun <= 0n) throw new Error("Amount must be positive");

  const raw = await tronApi(endpoint, "/wallet/createtransaction", {
    to_address: toHex,
    owner_address: addressHex,
    amount: Number(sun),
    visible: false,
  });
  const rawHex = raw.raw_data_hex;
  const txId = raw.txID;
  if (typeof rawHex !== "string" || typeof txId !== "string") {
    throw new Error("Tron API did not return a signable transaction");
  }

  const digest = sha256(Buffer.from(rawHex, "hex"));
  const signature = secp256k1.sign(digest, Buffer.from(privateKey, "hex"));
  if (signature.recovery == null) {
    throw new Error("Could not compute signature recovery id");
  }
  const r = signature.r.toString(16).padStart(64, "0");
  const s = signature.s.toString(16).padStart(64, "0");
  const sigHex = `${r}${s}${signature.recovery.toString(16).padStart(2, "0")}`;

  const broadcast = await tronApi(endpoint, "/wallet/broadCastTransaction", {
    txID: txId,
    raw_data: raw.raw_data,
    raw_data_hex: rawHex,
    signature: [sigHex],
  });
  if (broadcast.result === false || broadcast.message) {
    const message = typeof broadcast.message === "string"
      ? Buffer.from(broadcast.message, "hex").toString("utf8")
      : "Tron broadcast rejected";
    throw new Error(message);
  }
  return {
    hash: txId,
    from: fromAddress,
    to,
    valueRaw: sun.toString(),
    status: "pending",
    explorerUrl: explorerTemplate.replace("$TX", txId),
  };
}

/* ------------------------------ vault recovery ------------------------------ */

/**
 * Reveal the user's master recovery seed (64 hex chars = 32 bytes of
 * entropy). Every account key on every chain derives from it, so this is
 * the single most sensitive secret in Freman. Requires the explicit
 * `confirmed: true` literal — the client must gate this behind a typed
 * acknowledgement — and is never logged.
 */
export const revealVaultSeed = action({
  args: { confirmed: v.literal(true) },
  returns: v.object({ seedHex: v.string() }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const seed = await masterSeed(ctx, userId);
    return { seedHex: seed.toString("hex") };
  },
});

/**
 * Export an account's private key. Legacy rows carry their own encrypted
 * key; vault rows are re-derived from the master seed at the account's
 * derivation index and verified against the stored address.
 */
export const revealAccountKey = action({
  args: { accountId: v.id("walletAccounts"), confirmed: v.literal(true) },
  returns: v.object({
    address: v.string(),
    chainType: v.string(),
    encoding: v.string(), // "hex" (EVM / Tron) or "base58" (Solana)
    privateKey: v.string(),
  }),
  handler: async (
    ctx,
    { accountId },
  ): Promise<{
    address: string;
    chainType: string;
    encoding: string;
    privateKey: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
    if (!account) throw new Error("Account not found");
    const chainType = (account.chainType as ChainType | undefined) ?? "evm";

    if (account.encryptedPrivateKey) {
      return {
        address: account.address,
        chainType,
        encoding: "hex",
        privateKey: decryptSecret(account.encryptedPrivateKey),
      };
    }

    const seed = await masterSeed(ctx, userId);
    const index = account.derivationIndex ?? 0;
    if (chainType === "solana") {
      const derived = deriveSolana(seed, index);
      if (derived.address !== account.address) {
        throw new Error("Derived key does not match this account");
      }
      return {
        address: account.address,
        chainType,
        encoding: "base58",
        privateKey: base58Encode(derived.privateKey),
      };
    }
    if (chainType === "tron") {
      const derived = deriveTron(seed, index);
      if (derived.address !== account.address) {
        throw new Error("Derived key does not match this account");
      }
      return {
        address: account.address,
        chainType,
        encoding: "hex",
        privateKey: derived.privateKey,
      };
    }
    const derived = deriveEvm(seed, index);
    if (derived.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("Derived key does not match this account");
    }
    return {
      address: account.address,
      chainType,
      encoding: "hex",
      privateKey: derived.privateKey,
    };
  },
});

/* ----------------------------------- swap ---------------------------------- */

/**
 * Token swaps via on-chain liquidity aggregators, executed custodially:
 *  - Solana: Jupiter (public lite API, no key) — quote, sign, broadcast.
 *  - EVM: 0x Swap API v2 (requires ZEROX_API_KEY) — approval + swap tx.
 * Mainnet only — aggregators have no meaningful liquidity on testnets.
 */

const JUPITER_BASES = [
  "https://lite-api.jup.ag/swap/v1",
  "https://quote-api.jup.ag/v6",
];
const SOL_MINT = "So11111111111111111111111111111111111111112";
const ZEROX_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function tokenDecimalsFor(network: string, token: string): number {
  if (token === "native") {
    return network.startsWith("solana") ? 9 : network.startsWith("tron") ? 6 : 18;
  }
  const known = KNOWN_TOKENS[network] ?? [];
  const match = known.find((t) => t.address === token);
  if (!match) throw new Error(`Unknown token ${token} on ${network}`);
  return match.decimals;
}

function humanToRaw(amount: string, decimals: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Amount must be a positive number");
  return BigInt(Math.floor(n * 10 ** decimals)).toString();
}

interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
}

async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  slippageBps: number,
): Promise<{ quote: JupiterQuote; base: string }> {
  let lastError: unknown = new Error("Jupiter unavailable");
  for (const base of JUPITER_BASES) {
    try {
      const res = await fetch(
        `${base}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${slippageBps}`,
      );
      if (!res.ok) throw new Error(`Jupiter quote failed (${res.status})`);
      return { quote: (await res.json()) as JupiterQuote, base };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Jupiter quote failed");
}

/** Compact-u16 reader (Solana vector lengths). Returns [value, bytesUsed]. */
function readCompactU16(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let used = 0;
  for (;;) {
    const b = bytes[offset + used];
    used += 1;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new Error("Malformed transaction");
  }
  return [value, used];
}

/**
 * Sign a pre-built Solana transaction (e.g. from Jupiter) at signature slot
 * 0, verifying that the fee payer is our own address before signing.
 */
function signSolanaRawTx(rawB64: string, privateKey: Uint8Array, expectedPayer: string): string {
  const raw = new Uint8Array(Buffer.from(rawB64, "base64"));
  const [sigCount, sigCountBytes] = readCompactU16(raw, 0);
  if (sigCount < 1) throw new Error("Malformed transaction (no signatures)");
  const message = raw.subarray(sigCountBytes + sigCount * 64);
  if (message.length < 4) throw new Error("Malformed transaction (short message)");
  const numSigs = message[0] & 0x7f;
  const [acctCount, acctCountBytes] = readCompactU16(message, 3);
  if (numSigs < 1 || acctCount < 1) throw new Error("Malformed swap transaction");
  const payer = base58Encode(message.subarray(3 + acctCountBytes, 3 + acctCountBytes + 32));
  if (payer !== expectedPayer) {
    throw new Error("Swap transaction fee payer does not match this account");
  }
  const signature = ed25519.sign(message, privateKey);
  raw.set(signature, sigCountBytes);
  return Buffer.from(raw).toString("base64");
}

/** Swap quote — preview only, no funds move. */
export const swapQuote = action({
  args: {
    accountId: v.id("walletAccounts"),
    network: v.string(),
    sellToken: v.string(), // "native" or token address
    buyToken: v.string(),
    amount: v.string(), // human units
    slippageBps: v.optional(v.number()),
  },    returns: v.object({
      provider: v.string(),
      sellAmountRaw: v.string(),
      buyAmountRaw: v.string(),
      sellDecimals: v.number(),
      buyDecimals: v.number(),
      priceImpactPct: v.optional(v.string()),
    }),
    handler: async (
      ctx,
      { accountId, network, sellToken, buyToken, amount, slippageBps },
    ): Promise<{
      provider: string;
      sellAmountRaw: string;
      buyAmountRaw: string;
      sellDecimals: number;
      buyDecimals: number;
      priceImpactPct?: string;
    }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
    if (!account) throw new Error("Account not found");
    const slippage = Math.min(Math.max(slippageBps ?? 50, 1), 3000);

    if (network === "solana:mainnet") {
      const inputMint = sellToken === "native" ? SOL_MINT : sellToken;
      const outputMint = buyToken === "native" ? SOL_MINT : buyToken;
      const decimals = tokenDecimalsFor(network, sellToken);
      const amountRaw = humanToRaw(amount, decimals);
      const { quote } = await jupiterQuote(inputMint, outputMint, amountRaw, slippage);
      return {
        provider: "jupiter",
        sellAmountRaw: amountRaw,
        buyAmountRaw: quote.outAmount,
        sellDecimals: decimals,
        buyDecimals: tokenDecimalsFor(network, buyToken),
        priceImpactPct: quote.priceImpactPct,
      };
    }

    if (EVM_CHAINS[network] && !EVM_CHAINS[network].testnet) {
      const key = process.env.ZEROX_API_KEY;
      if (!key) {
        throw new Error("EVM swaps need a 0x API key — add ZEROX_API_KEY in the Keys tab.");
      }
      const chainId = EVM_CHAINS[network].chainId;
      const sellDecimals = tokenDecimalsFor(network, sellToken);
      const sellAmountRaw = humanToRaw(amount, sellDecimals);
      const sellTokenParam = sellToken === "native" ? "ETH" : sellToken;
      const buyTokenParam = buyToken === "native" ? "ETH" : buyToken;
      const res = await fetch(
        `https://api.0x.org/swap/permit2/quote?chainId=${chainId}&sellToken=${sellTokenParam}&buyToken=${buyTokenParam}&sellAmount=${sellAmountRaw}&taker=${account.address}&slippageBps=${slippage}`,
        { headers: { "0x-api-key": key, "0x-version": "v2" } },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string; description?: string };
        throw new Error(body.reason ?? body.description ?? `0x quote failed (${res.status})`);
      }
      const quote = (await res.json()) as { buyAmount: string; sellAmount: string; issues?: { priceImpact?: { impact?: { bps?: string } } } };
      return {
        provider: "0x",
        sellAmountRaw: quote.sellAmount ?? sellAmountRaw,
        buyAmountRaw: quote.buyAmount,
        sellDecimals,
        buyDecimals: tokenDecimalsFor(network, buyToken),
        priceImpactPct: quote.issues?.priceImpact?.impact?.bps,
      };
    }

    throw new Error("Swaps are mainnet-only — testnets have no aggregator liquidity.");
  },
});

/**
 * Execute a token swap from a custodial account. Quotes internally (fresh
 * price), signs with the account's derived key and broadcasts. Returns the
 * swap hash plus, on ERC-20 sells, the approval hash if one was needed.
 */
export const swapTokens = action({
  args: {
    accountId: v.id("walletAccounts"),
    network: v.string(),
    sellToken: v.string(),
    buyToken: v.string(),
    amount: v.string(),
    slippageBps: v.optional(v.number()),
    confirmed: v.optional(v.boolean()),
  },
  returns: v.object({
    hash: v.string(),
    explorerUrl: v.string(),
    buyAmountRaw: v.string(),
    buyDecimals: v.number(),
    approvalHash: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    { accountId, network, sellToken, buyToken, amount, slippageBps, confirmed },
  ): Promise<{
    hash: string;
    explorerUrl: string;
    buyAmountRaw: string;
    buyDecimals: number;
    approvalHash?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
    if (!account) throw new Error("Account not found");
    const chainType = (account.chainType as ChainType | undefined) ?? "evm";
    const slippage = Math.min(Math.max(slippageBps ?? 50, 1), 3000);
    const isMainnet =
      network === "solana:mainnet" ||
      (Boolean(EVM_CHAINS[network]) && !EVM_CHAINS[network].testnet);
    if (!isMainnet) {
      throw new Error("Swaps are mainnet-only — testnets have no aggregator liquidity.");
    }
    if (network.startsWith("tron:")) {
      throw new Error("Tron swaps are not supported yet.");
    }
    if (!confirmed) {
      throw new Error("Mainnet swaps move real funds and must be explicitly confirmed.");
    }

    /* ------------------------------ Solana ------------------------------ */
    if (network === "solana:mainnet") {
      if (chainType !== "solana") throw new Error("This account is not a Solana account");
      const inputMint = sellToken === "native" ? SOL_MINT : sellToken;
      const outputMint = buyToken === "native" ? SOL_MINT : buyToken;
      const sellDecimals = tokenDecimalsFor(network, sellToken);
      const amountRaw = humanToRaw(amount, sellDecimals);
      const { quote, base } = await jupiterQuote(inputMint, outputMint, amountRaw, slippage);

      const swapRes = await fetch(`${base}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: account.address,
          wrapAndUnwrapSol: true,
        }),
      });
      if (!swapRes.ok) {
        throw new Error(`Jupiter swap build failed (${swapRes.status})`);
      }
      const { swapTransaction } = (await swapRes.json()) as { swapTransaction?: string };
      if (!swapTransaction) throw new Error("Jupiter returned no transaction");

      const seed = await masterSeed(ctx, userId);
      const { privateKey } = deriveSolana(seed, account.derivationIndex ?? 0);
      if (base58Encode(ed25519.getPublicKey(privateKey)) !== account.address) {
        throw new Error("Derived key does not match this account");
      }
      const signed = signSolanaRawTx(swapTransaction, privateKey, account.address);
      const net = SOLANA_NETWORKS[network];
      const hash = await solanaRpc<string>(net.endpoint, "sendTransaction", [
        signed,
        { encoding: "base64", skipPreflight: false },
      ]);
      const txHash = typeof hash === "string" ? hash : "unknown";
      await ctx.runMutation(api.transactions.record, {
        accountId,
        hash: txHash,
        from: account.address,
        to: outputMint,
        valueWei: amountRaw,
        chainId: 0,
        chain: network,
        status: "pending",
      });
      return {
        hash: txHash,
        explorerUrl: net.explorer.replace("$TX", txHash),
        buyAmountRaw: quote.outAmount,
        buyDecimals: tokenDecimalsFor(network, buyToken),
      };
    }

    /* -------------------------------- EVM -------------------------------- */
    if (chainType !== "evm") throw new Error("This account is not an EVM account");
    const key = process.env.ZEROX_API_KEY;
    if (!key) {
      throw new Error("EVM swaps need a 0x API key — add ZEROX_API_KEY in the Keys tab.");
    }
    const evmChain = EVM_CHAINS[network];
    const provider = await evmProvider(evmChain);
    const sellDecimals = tokenDecimalsFor(network, sellToken);
    const sellAmountRaw = humanToRaw(amount, sellDecimals);
    const sellTokenParam = sellToken === "native" ? "ETH" : sellToken;
    const buyTokenParam = buyToken === "native" ? "ETH" : buyToken;

    const quoteRes = await fetch(
      `https://api.0x.org/swap/permit2/quote?chainId=${evmChain.chainId}&sellToken=${sellTokenParam}&buyToken=${buyTokenParam}&sellAmount=${sellAmountRaw}&taker=${account.address}&slippageBps=${slippage}`,
      { headers: { "0x-api-key": key, "0x-version": "v2" } },
    );
    if (!quoteRes.ok) {
      const body = (await quoteRes.json().catch(() => ({}))) as { reason?: string; description?: string };
      throw new Error(body.reason ?? body.description ?? `0x quote failed (${quoteRes.status})`);
    }
    const quote = (await quoteRes.json()) as {
      buyAmount: string;
      transaction: { to: string; data: string; value?: string; gas?: string; gasPrice?: string };
    };

    let seed: Buffer | null = null;
    let privateKey: string;
    if (account.encryptedPrivateKey) {
      privateKey = decryptSecret(account.encryptedPrivateKey);
    } else {
      seed = await masterSeed(ctx, userId);
      privateKey = deriveEvm(seed, account.derivationIndex ?? 0).privateKey;
    }
    const signer = new EvmWallet(privateKey, provider);
    if (signer.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("Stored key does not match this account");
    }

    let approvalHash: string | undefined;
    const needsApproval = sellToken !== "native";
    if (needsApproval) {
      const erc20 = new Contract(
        sellToken,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
          "function approve(address spender, uint256 amount) returns (bool)",
        ],
        provider,
      );
      const current: bigint = await erc20.allowance(account.address, ZEROX_PERMIT2);
      if (current < BigInt(sellAmountRaw)) {
        const approval = await signer.sendTransaction({
          to: sellToken,
          data: (erc20.interface as unknown as {
            encodeFunctionData: (name: string, params: unknown[]) => string;
          }).encodeFunctionData("approve", [ZEROX_PERMIT2, 2n ** 256n - 1n]),
        });
        await approval.wait();
        approvalHash = approval.hash;
      }
    }

    const swapTx = await signer.sendTransaction({
      to: quote.transaction.to,
      data: quote.transaction.data,
      value: quote.transaction.value ? BigInt(quote.transaction.value) : undefined,
      gasLimit: quote.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
      gasPrice: quote.transaction.gasPrice ? BigInt(quote.transaction.gasPrice) : undefined,
    });
    const receipt = await swapTx.wait();

    await ctx.runMutation(api.transactions.record, {
      accountId,
      hash: swapTx.hash,
      from: account.address,
      to: buyTokenParam,
      valueWei: sellAmountRaw,
      chainId: evmChain.chainId,
      chain: network,
      status: receipt ? "confirmed" : "pending",
      blockNumber: receipt?.blockNumber,
      gasUsedWei: receipt?.gasUsed?.toString(),
    });

    return {
      hash: swapTx.hash,
      explorerUrl: `${evmChain.explorer}/tx/${swapTx.hash}`,
      buyAmountRaw: quote.buyAmount,
      buyDecimals: tokenDecimalsFor(network, buyToken),
      approvalHash,
    };
  },
});
