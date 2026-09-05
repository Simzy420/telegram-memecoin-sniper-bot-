import type { AppConfig } from '../config.js';
import type { BuyResult, Position, PriceFeed, SellResult } from './types.js';

export type ExitReason = 'take-profit' | 'stop-loss';

/**
 * Core sniping/trading engine.
 *
 * In `dry-run` mode all trades are simulated in-memory against an injected
 * {@link PriceFeed}, so the full flow can run without funds, wallets, or
 * network access. `live` mode is intentionally not implemented in this
 * scaffold: it throws instead of silently placing real orders.
 */
export class SniperEngine {
  private readonly positions = new Map<string, Position>();

  constructor(
    private readonly config: AppConfig,
    private readonly priceFeed: PriceFeed,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Attempt to buy ("snipe") the token at `address`. */
  async snipe(address: string): Promise<BuyResult> {
    const key = address.toLowerCase();
    if (this.positions.has(key)) {
      return { ok: false, reason: `Already holding a position in ${address}` };
    }

    const token = await this.priceFeed.getToken(address);
    if (!token) {
      return { ok: false, reason: `Token not found: ${address}` };
    }
    if (token.price <= 0) {
      return { ok: false, reason: `Invalid price for ${token.symbol}` };
    }

    if (this.config.tradingMode === 'live') {
      throw new Error(
        'Live trading is not implemented in this scaffold. Set TRADING_MODE=dry-run.',
      );
    }

    const spent = this.config.buyAmount;
    const quantity = spent / token.price;
    const position: Position = {
      token,
      amountSpent: spent,
      quantity,
      entryPrice: token.price,
      openedAt: this.now(),
    };
    this.positions.set(key, position);
    return { ok: true, position, spent };
  }

  /** Close a position. Optionally override the exit price (defaults to the live feed price). */
  async sell(address: string, currentPriceOverride?: number): Promise<SellResult> {
    const key = address.toLowerCase();
    const position = this.positions.get(key);
    if (!position) {
      return { ok: false, reason: `No open position in ${address}` };
    }

    let exitPrice = currentPriceOverride;
    if (exitPrice === undefined) {
      const token = await this.priceFeed.getToken(address);
      if (!token) {
        return { ok: false, reason: `Could not fetch price for ${address}` };
      }
      exitPrice = token.price;
    }

    const proceeds = position.quantity * exitPrice;
    const pnl = proceeds - position.amountSpent;
    const pnlPct = pnl / position.amountSpent;
    this.positions.delete(key);
    return { ok: true, proceeds, pnl, pnlPct };
  }

  /** Given a current price, decide whether take-profit or stop-loss is triggered. */
  evaluateExit(position: Position, currentPrice: number): ExitReason | null {
    const changePct = (currentPrice - position.entryPrice) / position.entryPrice;
    if (changePct >= this.config.takeProfit) return 'take-profit';
    if (changePct <= -this.config.stopLoss) return 'stop-loss';
    return null;
  }

  getPositions(): Position[] {
    return [...this.positions.values()];
  }

  getPosition(address: string): Position | undefined {
    return this.positions.get(address.toLowerCase());
  }
}
