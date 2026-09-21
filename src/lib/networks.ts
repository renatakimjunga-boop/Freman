/**
 * Frontend mirror of the custodial wallet's supported networks. Every entry
 * here is backed by a live public RPC endpoint in
 * src/convex/custodialWallet.ts — nothing on this list is decorative.
 */

export type ChainFamily = "evm" | "solana" | "tron";

export interface NetworkMeta {
  id: string;
  label: string;
  family: ChainFamily;
  symbol: string;
  testnet: boolean;
}

export const NETWORKS: NetworkMeta[] = [
  { id: "sepolia", label: "Ethereum Sepolia", family: "evm", symbol: "ETH", testnet: true },
  { id: "mainnet", label: "Ethereum", family: "evm", symbol: "ETH", testnet: false },
  { id: "polygon", label: "Polygon", family: "evm", symbol: "POL", testnet: false },
  { id: "bsc", label: "BNB Smart Chain", family: "evm", symbol: "BNB", testnet: false },
  { id: "arbitrum", label: "Arbitrum One", family: "evm", symbol: "ETH", testnet: false },
  { id: "base", label: "Base", family: "evm", symbol: "ETH", testnet: false },
  { id: "solana:devnet", label: "Solana Devnet", family: "solana", symbol: "SOL", testnet: true },
  { id: "solana:mainnet", label: "Solana", family: "solana", symbol: "SOL", testnet: false },
  { id: "tron:nile", label: "Tron Nile (test)", family: "tron", symbol: "TRX", testnet: true },
  { id: "tron:mainnet", label: "Tron", family: "tron", symbol: "TRX", testnet: false },
];

export const FAMILY_LABELS: Record<ChainFamily, string> = {
  evm: "EVM",
  solana: "Solana",
  tron: "Tron",
};

/** Sensible default network per chain family (testnets where they exist). */
export const DEFAULT_NETWORKS: Record<ChainFamily, string> = {
  evm: "sepolia",
  solana: "solana:devnet",
  tron: "tron:nile",
};

export function networkMeta(id: string): NetworkMeta | undefined {
  return NETWORKS.find((n) => n.id === id);
}

export function networksForFamily(family: ChainFamily): NetworkMeta[] {
  return NETWORKS.filter((n) => n.family === family);
}

/** Chain family of a wallet account row (legacy rows are EVM). */
export function accountFamily(account: { chainType?: string | null }): ChainFamily {
  if (account.chainType === "solana" || account.chainType === "tron") {
    return account.chainType;
  }
  return "evm";
}

/** Per-family recipient address validation. */
export function isValidRecipient(family: ChainFamily, address: string): boolean {
  if (family === "evm") return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (family === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  // Solana: base58, 32–44 chars.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/** Compact display for any chain address. */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
