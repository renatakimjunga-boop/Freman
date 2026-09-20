"use node";

import crypto from "crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  Wallet,
  JsonRpcProvider,
  parseEther,
  formatEther,
  formatUnits,
} from "ethers";

/**
 * Custodial wallet core for Freman's built-in wallet.
 *
 * - Private keys are generated server-side with ethers and encrypted at rest
 *   with AES-256-GCM using WALLET_ENCRYPTION_KEY.
 * - Balances are read live from public Ethereum RPC endpoints.
 * - Transactions are signed server-side and broadcast via sendRawTransaction.
 *   Default network is Sepolia (testnet) — mainnet sends require a confirmed
 *   warning, since they move real value.
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

function encryptPrivateKey(privateKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv,
  );
  const enc = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v2",
    iv.toString("hex"),
    tag.toString("hex"),
    enc.toString("hex"),
  ].join(":");
}

function decryptPrivateKey(blob: string): string {
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

/* --------------------------------- chains --------------------------------- */

interface ChainConfig {
  name: string;
  chainId: number;
  rpcs: string[];
  explorer: string;
}

export const CHAINS: Record<"sepolia" | "mainnet", ChainConfig> = {
  sepolia: {
    name: "Sepolia",
    chainId: 11155111,
    rpcs: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.org",
      "https://1rpc.io/sepolia",
    ],
    explorer: "https://sepolia.etherscan.io",
  },
  mainnet: {
    name: "Ethereum",
    chainId: 1,
    rpcs: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://cloudflare-eth.com",
    ],
    explorer: "https://etherscan.io",
  },
};

/** Try each public RPC in order; ethers polls chainId to validate. */
async function workingRpc(chain: keyof typeof CHAINS): Promise<string> {
  let lastError: unknown = new Error("no RPCs configured");
  for (const url of CHAINS[chain].rpcs) {
    try {
      const probe = new JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      });
      await probe.getNetwork();
      return url;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All public RPCs failed");
}

function provider(chain: keyof typeof CHAINS): Promise<JsonRpcProvider> {
  return workingRpc(chain).then(
    (url) =>
      new JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      }),
  );
}

/* --------------------------------- actions -------------------------------- */

/**
 * Create a custodial account: a real secp256k1 keypair generated server-side,
 * private key encrypted with AES-256-GCM before it ever touches the database.
 */
export const createCustodialAccount = action({
  args: { label: v.string() },
  handler: async (ctx, { label }): Promise<{ accountId: string; address: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const wallet = Wallet.createRandom();
    const encryptedPrivateKey = encryptPrivateKey(wallet.privateKey);

    const accountId = await ctx.runMutation(api.wallet.insertCustodial, {
      label,
      address: wallet.address,
      encryptedPrivateKey,
    });

    return { accountId, address: wallet.address };
  },
});

/** Live ETH balance + formatted value for an address on a given chain. */
export const getBalance = action({
  args: { address: v.string(), chain: v.string() },
  handler: async (_ctx, { address, chain }): Promise<{
    balanceWei: string;
    balanceEth: string;
    chain: string;
    chainId: number;
  }> => {
    const key = (chain === "mainnet" ? "mainnet" : "sepolia") as
      | "mainnet"
      | "sepolia";
    const rpc = await provider(key);
    const wei = await rpc.getBalance(address);
    return {
      balanceWei: wei.toString(),
      balanceEth: formatEther(wei),
      chain: CHAINS[key].name,
      chainId: CHAINS[key].chainId,
    };
  },
});

/**
 * Send ETH from a custodial account. Signs with the stored encrypted key and
 * broadcasts the raw transaction. On mainnet, require `confirmed: true` — the
 * client must show a real-value warning first.
 */
interface SendResult {
  hash: string;
  from: string;
  to: string;
  valueWei: string;
  chain: "sepolia" | "mainnet";
  status: "pending" | "confirmed";
  blockNumber?: number;
  gasUsedWei?: string;
  explorerUrl: string;
}

export const sendTransaction = action({
  args: {
    accountId: v.id("walletAccounts"),
    to: v.string(),
    amountEth: v.string(),
    chain: v.string(),
    confirmed: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { accountId, to, amountEth, chain, confirmed },
  ): Promise<SendResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const account = await ctx.runQuery(api.wallet.getForSigning, { accountId });
    if (!account) {
      throw new Error("Account not found");
    }
    if (!account.encryptedPrivateKey) {
      throw new Error(
        "This account predates the custodial upgrade — its key isn't stored. Create a new account to send.",
      );
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
      throw new Error("Invalid recipient address");
    }

    const key = (chain === "mainnet" ? "mainnet" : "sepolia") as
      | "mainnet"
      | "sepolia";
    if (key === "mainnet" && confirmed !== true) {
      throw new Error(
        "Mainnet sends move real funds and must be explicitly confirmed.",
      );
    }

    const amount = parseEther(amountEth);
    if (amount <= 0n) throw new Error("Amount must be positive");

    const signer = new Wallet(
      decryptPrivateKey(account.encryptedPrivateKey),
      await provider(key),
    );

    // Address mismatch would mean the key was tampered with — refuse.
    if (signer.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("Stored key does not match this account");
    }

    const tx = await signer.sendTransaction({
      to,
      value: amount,
    });
    const receipt = await tx.wait();

    // Persist so History can show the real send.
    await ctx.runMutation(api.transactions.record, {
      accountId,
      hash: tx.hash,
      from: account.address,
      to,
      valueWei: amount.toString(),
      chain: key,
      status: receipt ? "confirmed" : "pending",
      blockNumber: receipt?.blockNumber,
      gasUsedWei: receipt?.gasUsed?.toString(),
    });

    return {
      hash: tx.hash,
      from: account.address,
      to,
      valueWei: amount.toString(),
      chain: key,
      status: receipt ? "confirmed" : "pending",
      blockNumber: receipt?.blockNumber ?? undefined,
      gasUsedWei: receipt?.gasUsed?.toString(),
      explorerUrl: `${CHAINS[key].explorer}/tx/${tx.hash}`,
    };
  },
});


