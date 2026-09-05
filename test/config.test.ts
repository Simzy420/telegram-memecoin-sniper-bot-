import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies safe defaults with an empty env', () => {
    const config = loadConfig({});
    expect(config.tradingMode).toBe('dry-run');
    expect(config.chain).toBe('solana');
    expect(config.buyAmount).toBe(0.1);
    expect(config.takeProfit).toBe(0.5);
    expect(config.stopLoss).toBe(0.2);
    expect(config.allowedUserIds).toEqual([]);
    expect(config.telegramBotToken).toBeUndefined();
  });

  it('parses provided values', () => {
    const config = loadConfig({
      TRADING_MODE: 'dry-run',
      CHAIN: 'ethereum',
      BUY_AMOUNT: '0.5',
      ALLOWED_USER_IDS: '1, 2 ,3',
      TELEGRAM_BOT_TOKEN: 'abc',
    });
    expect(config.chain).toBe('ethereum');
    expect(config.buyAmount).toBe(0.5);
    expect(config.allowedUserIds).toEqual([1, 2, 3]);
    expect(config.telegramBotToken).toBe('abc');
  });

  it('requires a token in live mode', () => {
    expect(() => loadConfig({ TRADING_MODE: 'live' })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ TRADING_MODE: 'wild' })).toThrow(/TRADING_MODE/);
    expect(() => loadConfig({ CHAIN: 'dogechain' })).toThrow(/CHAIN/);
    expect(() => loadConfig({ BUY_AMOUNT: '-1' })).toThrow(/BUY_AMOUNT/);
    expect(() => loadConfig({ ALLOWED_USER_IDS: 'abc' })).toThrow(/ALLOWED_USER_IDS/);
  });
});
