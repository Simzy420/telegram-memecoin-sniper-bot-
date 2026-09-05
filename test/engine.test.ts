import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SniperEngine } from '../src/sniper/engine.js';
import { SimulatedPriceFeed } from '../src/sniper/simulatedFeed.js';

const ADDR = 'TokenAddr123';

function makeEngine(overrides: Record<string, string> = {}) {
  const config = loadConfig({ BUY_AMOUNT: '1', TAKE_PROFIT: '0.5', STOP_LOSS: '0.2', ...overrides });
  const feed = new SimulatedPriceFeed([
    SimulatedPriceFeed.defaultToken(ADDR, 'DOGE', 0.01, 'solana'),
  ]);
  return { engine: new SniperEngine(config, feed, () => 1000), feed };
}

describe('SniperEngine', () => {
  it('snipes a token and records a position', async () => {
    const { engine } = makeEngine();
    const result = await engine.snipe(ADDR);
    expect(result.ok).toBe(true);
    expect(result.position?.quantity).toBeCloseTo(100); // 1 / 0.01
    expect(engine.getPositions()).toHaveLength(1);
  });

  it('refuses to double-buy the same token', async () => {
    const { engine } = makeEngine();
    await engine.snipe(ADDR);
    const second = await engine.snipe(ADDR);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/Already holding/);
  });

  it('fails to snipe an unknown token', async () => {
    const { engine } = makeEngine();
    const result = await engine.snipe('DoesNotExist');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('realizes profit on sell after a pump', async () => {
    const { engine, feed } = makeEngine();
    await engine.snipe(ADDR);
    feed.movePrice(ADDR, 2); // +100%
    const result = await engine.sell(ADDR);
    expect(result.ok).toBe(true);
    expect(result.pnl).toBeCloseTo(1); // spent 1, proceeds 2
    expect(result.pnlPct).toBeCloseTo(1);
    expect(engine.getPositions()).toHaveLength(0);
  });

  it('realizes a loss on sell after a dump', async () => {
    const { engine, feed } = makeEngine();
    await engine.snipe(ADDR);
    feed.movePrice(ADDR, 0.5); // -50%
    const result = await engine.sell(ADDR);
    expect(result.pnlPct).toBeCloseTo(-0.5);
  });

  it('evaluates take-profit and stop-loss thresholds', async () => {
    const { engine } = makeEngine();
    const buy = await engine.snipe(ADDR);
    const position = buy.position!;
    expect(engine.evaluateExit(position, 0.01)).toBeNull();
    expect(engine.evaluateExit(position, 0.016)).toBe('take-profit'); // +60% >= 50%
    expect(engine.evaluateExit(position, 0.007)).toBe('stop-loss'); // -30% <= -20%
  });

  it('throws instead of placing real orders in live mode', async () => {
    const config = loadConfig({ TRADING_MODE: 'live', TELEGRAM_BOT_TOKEN: 'x', BUY_AMOUNT: '1' });
    const feed = new SimulatedPriceFeed([
      SimulatedPriceFeed.defaultToken(ADDR, 'DOGE', 0.01),
    ]);
    const engine = new SniperEngine(config, feed);
    await expect(engine.snipe(ADDR)).rejects.toThrow(/not implemented/);
  });
});
