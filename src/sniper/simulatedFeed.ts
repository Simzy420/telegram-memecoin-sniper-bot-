import type { Chain, PriceFeed, TokenInfo } from './types.js';

export interface SimulatedFeedOptions {
  /**
   * When true, an unknown address is deterministically synthesized into a token
   * (stable symbol + price derived from the address) and cached. This models a
   * freshly launched memecoin being discovered on-chain for the first time.
   */
  autoGenerate?: boolean;
  defaultChain?: Chain;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic in-memory price feed for dry-run mode, demos, and tests.
 * A production feed would implement the same {@link PriceFeed} interface but
 * query an on-chain DEX or price aggregator instead.
 */
export class SimulatedPriceFeed implements PriceFeed {
  private readonly tokens = new Map<string, TokenInfo>();
  private readonly autoGenerate: boolean;
  private readonly defaultChain: Chain;

  constructor(seed: TokenInfo[] = [], options: SimulatedFeedOptions = {}) {
    this.autoGenerate = options.autoGenerate ?? false;
    this.defaultChain = options.defaultChain ?? 'solana';
    for (const token of seed) {
      this.tokens.set(token.address.toLowerCase(), { ...token });
    }
  }

  async getToken(address: string): Promise<TokenInfo | undefined> {
    const key = address.toLowerCase();
    const existing = this.tokens.get(key);
    if (existing) return { ...existing };
    if (!this.autoGenerate) return undefined;
    const generated = this.synthesize(address);
    this.tokens.set(key, generated);
    return { ...generated };
  }

  private synthesize(address: string): TokenInfo {
    const h = hash(address);
    const suffix = address.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'MEME';
    const price = 0.0000001 * (1 + (h % 1000));
    return { address, symbol: `MEME${suffix}`, price, chain: this.defaultChain };
  }

  /** Register or overwrite a token in the feed. */
  upsert(token: TokenInfo): void {
    this.tokens.set(token.address.toLowerCase(), { ...token });
  }

  /** Multiply a token's price by `factor` (e.g. 1.5 = +50%). Returns the new price. */
  movePrice(address: string, factor: number): number {
    const key = address.toLowerCase();
    const token = this.tokens.get(key);
    if (!token) throw new Error(`Unknown token: ${address}`);
    token.price = token.price * factor;
    return token.price;
  }

  static defaultToken(
    address: string,
    symbol: string,
    price: number,
    chain: Chain = 'solana',
  ): TokenInfo {
    return { address, symbol, price, chain };
  }
}
