import type { AppConfig } from './config.js';
import type { SniperEngine } from './sniper/engine.js';
import type { Position } from './sniper/types.js';

export interface CommandContext {
  engine: SniperEngine;
  config: AppConfig;
}

const HELP = [
  'Memecoin Sniper Bot',
  '',
  'Commands:',
  '  /start, /help        Show this message',
  '  /status              Show bot mode and settings',
  '  /snipe <address>     Buy (snipe) a token by address',
  '  /positions           List open positions',
  '  /sell <address>      Close a position',
  '',
  'Trading is simulated in dry-run mode. Nothing here is financial advice.',
].join('\n');

function fmt(n: number, digits = 6): string {
  return Number(n.toFixed(digits)).toString();
}

function fmtPct(fraction: number): string {
  const sign = fraction >= 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(1)}%`;
}

function describePosition(p: Position): string {
  return `• ${p.token.symbol} (${p.token.address}) — spent ${fmt(p.amountSpent)}, qty ${fmt(
    p.quantity,
    2,
  )} @ entry ${fmt(p.entryPrice, 9)}`;
}

function statusText(config: AppConfig, engine: SniperEngine): string {
  return [
    `Mode: ${config.tradingMode}`,
    `Chain: ${config.chain}`,
    `Buy amount: ${fmt(config.buyAmount)}`,
    `Take-profit: ${fmtPct(config.takeProfit)} | Stop-loss: ${fmtPct(-config.stopLoss)}`,
    `Max slippage: ${fmtPct(config.maxSlippage)}`,
    `Open positions: ${engine.getPositions().length}`,
  ].join('\n');
}

/**
 * Transport-agnostic command router. Returns the reply text for a raw command
 * string. Used by both the Telegram transport and the local simulator, so the
 * exact same logic is exercised end-to-end regardless of transport.
 */
export async function handleCommand(text: string, ctx: CommandContext): Promise<string> {
  const trimmed = text.trim();
  const [rawCommand, ...args] = trimmed.split(/\s+/);
  const command = (rawCommand ?? '').toLowerCase().replace(/@.*$/, '');

  switch (command) {
    case '/start':
    case '/help':
    case '':
      return HELP;

    case '/status':
      return statusText(ctx.config, ctx.engine);

    case '/snipe': {
      const address = args[0];
      if (!address) return 'Usage: /snipe <token-address>';
      const result = await ctx.engine.snipe(address);
      if (!result.ok || !result.position) {
        return `Snipe failed: ${result.reason ?? 'unknown error'}`;
      }
      const p = result.position;
      return [
        `Sniped ${p.token.symbol}!`,
        `Spent ${fmt(result.spent ?? p.amountSpent)} for ${fmt(p.quantity, 2)} tokens`,
        `Entry price: ${fmt(p.entryPrice, 9)}`,
      ].join('\n');
    }

    case '/positions': {
      const positions = ctx.engine.getPositions();
      if (positions.length === 0) return 'No open positions.';
      return ['Open positions:', ...positions.map(describePosition)].join('\n');
    }

    case '/sell': {
      const address = args[0];
      if (!address) return 'Usage: /sell <token-address>';
      const result = await ctx.engine.sell(address);
      if (!result.ok) return `Sell failed: ${result.reason ?? 'unknown error'}`;
      return [
        'Position closed.',
        `Proceeds: ${fmt(result.proceeds ?? 0)}`,
        `PnL: ${fmt(result.pnl ?? 0)} (${fmtPct(result.pnlPct ?? 0)})`,
      ].join('\n');
    }

    default:
      return `Unknown command: ${command}\n\n${HELP}`;
  }
}

export const helpText = HELP;
