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
  parseEther,
  formatEther,
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
        symbol: "TRX",      raw: String(sun),
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
