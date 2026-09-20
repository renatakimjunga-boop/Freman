export interface DappCatalogEntry {
  origin: string;
  name: string;
  chain: string;
  chainId: number;
  blurb: string;
}

/** dApps the built-in wallet can establish sessions with. */
export const DAPPS: DappCatalogEntry[] = [
  {
    origin: "app.uniswap.org",
    name: "Uniswap",
    chain: "Ethereum",
    chainId: 1,
    blurb: "Swap tokens and provide liquidity.",
  },
  {
    origin: "app.ens.domains",
    name: "ENS",
    chain: "Ethereum",
    chainId: 1,
    blurb: "Register and manage .eth names.",
  },
  {
    origin: "opensea.io",
    name: "OpenSea",
    chain: "Ethereum",
    chainId: 1,
    blurb: "Collect and trade non-fungible tokens.",
  },
  {
    origin: "app.aave.com",
    name: "Aave",
    chain: "Ethereum",
    chainId: 1,
    blurb: "Lend and borrow against collateral.",
  },
  {
    origin: "stake.lido.fi",
    name: "Lido",
    chain: "Ethereum",
    chainId: 1,
    blurb: "Liquid staking for your ETH.",
  },
  {
    origin: "sepolia.dev",
    name: "Sepolia Faucet",
    chain: "Sepolia",
    chainId: 11155111,
    blurb: "Testnet ETH for development builds.",
  },
];
