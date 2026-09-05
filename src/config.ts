import type { Chain, TradingMode } from './sniper/types.js';

export interface AppConfig {
  telegramBotToken: string | undefined;
  allowedUserIds: number[];
  tradingMode: TradingMode;
  chain: Chain;
  buyAmount: number;
  takeProfit: number;
  stopLoss: number;
  maxSlippage: number;
}

const VALID_CHAINS: Chain[] = ['solana', 'ethereum', 'base', 'bsc'];

function parseNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}: "${value}" (expected a non-negative number)`);
  }
  return parsed;
}

function parseUserIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number(part);
      if (!Number.isInteger(id)) {
        throw new Error(`Invalid ALLOWED_USER_IDS entry: "${part}" (expected an integer)`);
      }
      return id;
    });
}

/**
 * Build validated configuration from a raw environment map. Kept pure (env is
 * injected) so it is easy to unit test.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const tradingMode = (env.TRADING_MODE ?? 'dry-run').trim() as TradingMode;
  if (tradingMode !== 'dry-run' && tradingMode !== 'live') {
    throw new Error(`Invalid TRADING_MODE: "${tradingMode}" (expected "dry-run" or "live")`);
  }

  const chain = (env.CHAIN ?? 'solana').trim() as Chain;
  if (!VALID_CHAINS.includes(chain)) {
    throw new Error(`Invalid CHAIN: "${chain}" (expected one of ${VALID_CHAINS.join(', ')})`);
  }

  if (tradingMode === 'live' && !env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is required when TRADING_MODE=live');
  }

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    allowedUserIds: parseUserIds(env.ALLOWED_USER_IDS),
    tradingMode,
    chain,
    buyAmount: parseNumber(env.BUY_AMOUNT, 0.1, 'BUY_AMOUNT'),
    takeProfit: parseNumber(env.TAKE_PROFIT, 0.5, 'TAKE_PROFIT'),
    stopLoss: parseNumber(env.STOP_LOSS, 0.2, 'STOP_LOSS'),
    maxSlippage: parseNumber(env.MAX_SLIPPAGE, 0.15, 'MAX_SLIPPAGE'),
  };
}
