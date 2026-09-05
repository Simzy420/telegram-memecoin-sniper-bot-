export type Chain = 'solana' | 'ethereum' | 'base' | 'bsc';

export type TradingMode = 'dry-run' | 'live';

export interface TokenInfo {
  /** Token mint / contract address. */
  address: string;
  /** Human-readable symbol, e.g. "PEPE". */
  symbol: string;
  /** Chain the token lives on. */
  chain: Chain;
  /** Current price in quote currency (e.g. SOL or ETH) per token. */
  price: number;
}

export interface Position {
  token: TokenInfo;
  /** Quote currency spent to open the position. */
  amountSpent: number;
  /** Token quantity acquired. */
  quantity: number;
  /** Price at which the position was opened. */
  entryPrice: number;
  /** Timestamp (ms) the position was opened. */
  openedAt: number;
}

export interface BuyResult {
  ok: boolean;
  position?: Position;
  /** Realized quote spent including slippage. */
  spent?: number;
  reason?: string;
}

export interface SellResult {
  ok: boolean;
  /** Quote currency received. */
  proceeds?: number;
  /** Profit/loss in quote currency (proceeds - amountSpent). */
  pnl?: number;
  /** Profit/loss as a fraction of the amount spent. */
  pnlPct?: number;
  reason?: string;
}

/**
 * Abstraction over a chain/DEX price source. A real implementation would query
 * an on-chain DEX or aggregator; the simulator provides a deterministic stub.
 */
export interface PriceFeed {
  getToken(address: string): Promise<TokenInfo | undefined>;
}
