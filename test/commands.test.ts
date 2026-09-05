import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';
import { handleCommand, type CommandContext } from '../src/commands.js';
import { SniperEngine } from '../src/sniper/engine.js';
import { SimulatedPriceFeed } from '../src/sniper/simulatedFeed.js';

const ADDR = 'MemeAddr999';

function makeCtx(): CommandContext {
  const config = loadConfig({ BUY_AMOUNT: '1' });
  const feed = new SimulatedPriceFeed([
    SimulatedPriceFeed.defaultToken(ADDR, 'WOJAK', 0.005, 'solana'),
  ]);
  const engine = new SniperEngine(config, feed, () => 1000);
  return { engine, config };
}

describe('handleCommand', () => {
  let ctx: CommandContext;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it('returns help for /start and /help', async () => {
    expect(await handleCommand('/start', ctx)).toMatch(/Memecoin Sniper Bot/);
    expect(await handleCommand('/help', ctx)).toMatch(/Commands:/);
  });

  it('strips @botname suffix from commands', async () => {
    expect(await handleCommand('/status@my_bot', ctx)).toMatch(/Mode: dry-run/);
  });

  it('reports status', async () => {
    const reply = await handleCommand('/status', ctx);
    expect(reply).toMatch(/Mode: dry-run/);
    expect(reply).toMatch(/Open positions: 0/);
  });

  it('runs a full snipe -> positions -> sell flow', async () => {
    const snipe = await handleCommand(`/snipe ${ADDR}`, ctx);
    expect(snipe).toMatch(/Sniped WOJAK/);

    const positions = await handleCommand('/positions', ctx);
    expect(positions).toMatch(/WOJAK/);

    const sell = await handleCommand(`/sell ${ADDR}`, ctx);
    expect(sell).toMatch(/Position closed/);
    expect(await handleCommand('/positions', ctx)).toMatch(/No open positions/);
  });

  it('validates missing arguments', async () => {
    expect(await handleCommand('/snipe', ctx)).toMatch(/Usage: \/snipe/);
    expect(await handleCommand('/sell', ctx)).toMatch(/Usage: \/sell/);
  });

  it('handles unknown commands', async () => {
    expect(await handleCommand('/moon', ctx)).toMatch(/Unknown command/);
  });
});
