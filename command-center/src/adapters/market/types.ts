/** A coin the watchlist can price. `symbol` is the display ticker. */
export interface ResolvedCoin {
  coinId: string;
  symbol: string;
  name: string;
}

export interface MarketQuote {
  coinId: string;
  symbol: string;
  name: string;
  usd: number;
  /** Percent points from the feed (1.25 means +1.25%). Null when omitted. */
  change24hPct: number | null;
  /** Unix seconds reported by the source, when present. */
  updatedAt: number | null;
}

/**
 * Live market data. Implementations must return source numbers only —
 * never synthesized prices, candles, or P&L.
 */
export interface MarketAdapter {
  id: string;
  label: string;
  resolveSymbol(input: string): Promise<ResolvedCoin>;
  fetchQuotes(coins: ResolvedCoin[]): Promise<MarketQuote[]>;
}
