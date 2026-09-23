import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { formatEther, JsonRpcProvider } from "ethers";

/**
 * All-networks portfolio for the wallet page: aggregates the native balance
 * of every account on every network of its chain family, in parallel, via
 * public RPC. Token balances are read separately per network by the existing
 * `custodialWallet.getTokenBalances` action when a network is selected.
 */

// Must mirror the network keys of EVM_CHAINS / SOLANA_NETWORKS /
// TRON_NETWORKS in custodialWallet.ts, with the same public RPC endpoints.
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

const SOLANA_RPCS: Record<string, string[]> = {
  "solana:devnet": ["https://api.devnet.solana.com"],
  "solana:mainnet": ["https://api.mainnet-beta.solana.com"],
};

const TRON_ENDPOINTS: Record<string, string> = {
  "tron:mainnet": "https://api.trongrid.io",
  "tron:nile": "https://nile.trongrid.io",
};

interface NetworkRow {
  network: string;
  address: string;
  accountId: string;
  chainType: "evm" | "solana" | "tron";
  symbol: string;
  formatted: string;
  testnet: boolean;
}

interface PortfolioResult {
  rows: NetworkRow[];
  failed: string[]; // network ids whose RPC read failed
}

export const getPortfolio = action({
  args: {},
  returns: v.object({
    rows: v.array(
      v.object({
        network: v.string(),
        address: v.string(),
        accountId: v.string(),
        chainType: v.string(),
        symbol: v.string(),
        formatted: v.string(),
        testnet: v.boolean(),
      }),
    ),
    failed: v.array(v.string()),
  }),
  handler: async (ctx): Promise<PortfolioResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const accounts = await ctx.runQuery(api.wallet.listAccounts, {});
    if (accounts.length === 0) return { rows: [], failed: [] };

    const jobs: Array<Promise<NetworkRow | null>> = [];
    const failed = new Set<string>();

    const markFail = (network: string) => {
      failed.add(network);
      return null;
    };

    for (const account of accounts) {
      const t = (account.chainType as "evm" | "solana" | "tron" | undefined) ?? "evm";

      if (t === "evm") {
        for (const [network, rpcs] of Object.entries(EVM_RPCS)) {
          jobs.push(
            (async (): Promise<NetworkRow | null> => {
              try {
                let lastError: unknown = new Error("no RPCs configured");
                for (const url of rpcs) {
                  try {
                    const p = new JsonRpcProvider(url, undefined, {
                      staticNetwork: true,
                      batchMaxCount: 1,
                    });
                    await p.getNetwork();
                    const wei = await p.getBalance(account.address);
                    return {
                      network,
                      address: account.address,
                      accountId: account._id,
                      chainType: "evm",
                      symbol: SYMBOLS_BY_FAMILY.evm.symbolFor(network),
                      formatted: formatEther(wei),
                      testnet: TESTNETS.has(network),
                    };
                  } catch (err) {
                    lastError = err;
                  }
                }
                throw lastError;
              } catch {
                return markFail(network);
              }
            })(),
          );
        }
      } else if (t === "solana") {
        for (const [network, rpcs] of Object.entries(SOLANA_RPCS)) {
          jobs.push(
            (async (): Promise<NetworkRow | null> => {
              try {
                const res = await fetch(rpcs[0], {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "getBalance",
                    params: [account.address],
                  }),
                  signal: AbortSignal.timeout(12_000),
                });
                const json = (await res.json()) as {
                  error?: { message?: string };
                  result?: { value?: number };
                };
                if (json.error) throw new Error(json.error.message);
                const lamports = json.result?.value ?? 0;
                return {
                  network,
                  address: account.address,
                  accountId: account._id,
                  chainType: "solana",
                  symbol: "SOL",
                  formatted: (lamports / 1_000_000_000).toFixed(9),
                  testnet: network === "solana:devnet",
                };
              } catch {
                return markFail(network);
              }
            })(),
          );
        }
      } else {
        for (const [network, endpoint] of Object.entries(TRON_ENDPOINTS)) {
          jobs.push(
            (async (): Promise<NetworkRow | null> => {
              try {
                const res = await fetch(`${endpoint}/wallet/getaccount`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ address: account.address, visible: true }),
                  signal: AbortSignal.timeout(12_000),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const info = (await res.json()) as { balance?: number };
                const sun = typeof info.balance === "number" ? info.balance : 0;
                return {
                  network,
                  address: account.address,
                  accountId: account._id,
                  chainType: "tron",
                  symbol: "TRX",
                  formatted: (sun / 1_000_000).toFixed(6),
                  testnet: network === "tron:nile",
                };
              } catch {
                return markFail(network);
              }
            })(),
          );
        }
      }
    }

    const settled = await Promise.all(jobs);
    return {
      rows: settled.filter((r): r is NetworkRow => r !== null),
      failed: [...failed],
    };
  },
});

/* Symbols per EVM network (mirror of custodialWallet.ts EVM_CHAINS). */
const SYMBOLS_BY_FAMILY = {
  evm: {
    symbolFor: (network: string): string =>
      ({ sepolia: "ETH", mainnet: "ETH", polygon: "POL", bsc: "BNB", arbitrum: "ETH", base: "ETH" })[network] ?? "ETH",
  },
};

const TESTNETS = new Set(["sepolia", "solana:devnet", "tron:nile"]);
