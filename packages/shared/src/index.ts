export type AgentStatus = "new" | "wallet_ready" | "funded" | "armed";

export type ChainId =
  | "base"
  | "ethereum"
  | "binance"
  | "monad"
  | "robinhood"
  | "solana";

export interface ChainConfig {
  id: ChainId;
  label: string;
  symbol: string;
  family: "evm" | "solana";
  /** CoinGecko coin id for USD pricing */
  coingeckoId: string;
  /** Native decimals */
  decimals: number;
  /** EVM chain id when family === evm */
  evmChainId?: number;
}

/** Six funding networks matching the reference bot portfolio screen. */
export const CHAINS: ChainConfig[] = [
  {
    id: "base",
    label: "Base",
    symbol: "ETH",
    family: "evm",
    coingeckoId: "ethereum",
    decimals: 18,
    evmChainId: 8453,
  },
  {
    id: "ethereum",
    label: "Ethereum",
    symbol: "ETH",
    family: "evm",
    coingeckoId: "ethereum",
    decimals: 18,
    evmChainId: 1,
  },
  {
    id: "binance",
    label: "Binance",
    symbol: "BNB",
    family: "evm",
    coingeckoId: "binancecoin",
    decimals: 18,
    evmChainId: 56,
  },
  {
    id: "monad",
    label: "Monad",
    symbol: "MON",
    family: "evm",
    coingeckoId: "monad",
    decimals: 18,
    // Confirm with official docs when wiring RPC
    evmChainId: undefined,
  },
  {
    id: "robinhood",
    label: "Robinhood",
    symbol: "ETH",
    family: "evm",
    coingeckoId: "ethereum",
    decimals: 18,
    // Confirm chain id + RPC before mainnet funding tests
    evmChainId: undefined,
  },
  {
    id: "solana",
    label: "Solana",
    symbol: "SOL",
    family: "solana",
    coingeckoId: "solana",
    decimals: 9,
  },
];

export const DEFAULT_MIN_FUND_USD = 100;
