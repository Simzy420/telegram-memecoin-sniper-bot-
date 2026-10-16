import { coingeckoMarketAdapter } from './coingecko';
import type { MarketAdapter } from './types';

/** Live CoinGecko quotes. There is no mock price adapter. */
export function getMarketAdapter(): MarketAdapter {
  return coingeckoMarketAdapter;
}

export { coingeckoMarketAdapter, marketApiRoot } from './coingecko';
export type { MarketAdapter, MarketQuote, ResolvedCoin } from './types';
