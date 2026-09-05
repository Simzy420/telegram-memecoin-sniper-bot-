import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Telegram } from 'telegraf';
import type { Update } from 'telegraf/types';
import { loadConfig } from '../src/config.js';
import { createBot } from '../src/bot.js';
import { SniperEngine } from '../src/sniper/engine.js';
import { SimulatedPriceFeed } from '../src/sniper/simulatedFeed.js';

const ADDR = 'CatCoinAddr1';

// `callApi` lives on the (unexported) ApiClient prototype in telegraf's
// prototype chain, and `handleUpdate` builds a fresh Telegram per update — so we
// stub the shared prototype method to intercept every outbound API call.
function callApiOwner(): { callApi: (m: string, p: { text?: string }) => Promise<unknown> } {
  let proto: object | null = Telegram.prototype;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'callApi')) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto) throw new Error('could not locate callApi on telegraf prototype chain');
  return proto as { callApi: (m: string, p: { text?: string }) => Promise<unknown> };
}

const sent: string[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(callApiOwner(), 'callApi').mockImplementation(async (method, payload) => {
    if (method === 'getMe') return { id: 1, is_bot: true, username: 'test_bot', first_name: 'T' };
    if (method === 'sendMessage' && payload.text) sent.push(payload.text);
    return { message_id: sent.length };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeBot(allowedUserIds = '') {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test:token',
    BUY_AMOUNT: '1',
    ALLOWED_USER_IDS: allowedUserIds,
  });
  const feed = new SimulatedPriceFeed([
    SimulatedPriceFeed.defaultToken(ADDR, 'CAT', 0.01, 'solana'),
  ]);
  const engine = new SniperEngine(config, feed, () => 1000);
  return createBot(config, { engine, config });
}

let updateId = 1;
function textUpdate(text: string, userId = 42): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: 'private', first_name: 'T' },
      from: { id: userId, is_bot: false, first_name: 'T' },
      text,
    },
  } as unknown as Update;
}

describe('Telegram transport (createBot)', () => {
  it('routes updates through handleCommand and replies', async () => {
    const bot = makeBot();
    await bot.handleUpdate(textUpdate('/start'));
    await bot.handleUpdate(textUpdate(`/snipe ${ADDR}`));
    await bot.handleUpdate(textUpdate('/positions'));

    expect(sent[0]).toMatch(/Memecoin Sniper Bot/);
    expect(sent[1]).toMatch(/Sniped CAT/);
    expect(sent[2]).toMatch(/CAT/);
  });

  it('blocks unauthorized users when an allowlist is set', async () => {
    const bot = makeBot('100,200');
    await bot.handleUpdate(textUpdate('/status', 999));
    expect(sent[0]).toMatch(/Unauthorized/);

    await bot.handleUpdate(textUpdate('/status', 100));
    expect(sent[1]).toMatch(/Mode: dry-run/);
  });
});
