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

/* ---------------------------- tokens & pricing ---------------------------- */

/** Mirror of the custodial wallet's well-known token lists (swap + display). */
export interface TokenMeta {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export const NETWORK_TOKENS: Record<string, TokenMeta[]> = {
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
  "tron:mainnet": [
    { symbol: "USDT", name: "Tether USD", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
    { symbol: "USDC", name: "USD Coin", address: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6 },
  ],
  "tron:nile": [],
};

/** Block explorers per network (transaction-history links). */
export const EXPLORERS: Record<string, string> = {
  mainnet: "https://etherscan.io/tx/$TX",
  sepolia: "https://sepolia.etherscan.io/tx/$TX",
  polygon: "https://polygonscan.com/tx/$TX",
  bsc: "https://bscscan.com/tx/$TX",
  arbitrum: "https://arbiscan.io/tx/$TX",
  base: "https://basescan.org/tx/$TX",
  "solana:mainnet": "https://explorer.solana.com/tx/$TX",
  "solana:devnet": "https://explorer.solana.com/tx/$TX?cluster=devnet",
  "tron:mainnet": "https://tronscan.org/#/transaction/$TX",
  "tron:nile": "https://nile.tronscan.org/#/transaction/$TX",
};

/** CoinGecko coin id per native network (USD chart + pricing). */
export const NATIVE_PRICE_IDS: Record<string, string> = {
  mainnet: "ethereum",
  sepolia: "ethereum",
  arbitrum: "ethereum",
  base: "ethereum",
  polygon: "matic-network",
  bsc: "binancecoin",
  "solana:mainnet": "solana",
  "solana:devnet": "solana",
  "tron:mainnet": "tron",
  "tron:nile": "tron",
};

/** CoinGecko coin id per token symbol. */
export const TOKEN_PRICE_IDS: Record<string, string> = {
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  LINK: "chainlink",
  UNI: "uniswap",
  SHIB: "shiba-inu",
};

/** Format a chain's smallest-unit amount into human units for that chain. */
export function formatChainAmount(chain: string, valueWei: string): string {
  const decimals = chain.startsWith("solana")
    ? 9
    : chain.startsWith("tron")
      ? 6
      : 18;
  const n = Number(BigInt(valueWei || "0")) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: 9 });
}
