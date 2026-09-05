# telegram-memecoin-sniper-bot

A Telegram bot that snipes (auto-buys) newly launched memecoins, tracks
positions, and applies take-profit / stop-loss rules.

> ⚠️ **Safety first.** The bot defaults to a **dry-run** mode that simulates all
> trades in memory. `live` trading is intentionally not implemented in this
> scaffold — it throws instead of placing real orders. Nothing here is financial
> advice.

## Stack

- Node.js 20+ / TypeScript (ESM)
- [Telegraf](https://telegraf.js.org/) for the Telegram transport
- Vitest for tests, ESLint for linting

## Getting started

```bash
npm ci
cp .env.example .env      # then edit values
npm run simulate          # end-to-end dry-run, no Telegram/secrets needed
```

### Run against Telegram

Set `TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)) in `.env`,
then:

```bash
npm run dev     # watch mode
# or
npm run build && npm start
```

Talk to your bot and use the commands below.

## Bot commands

| Command | Description |
| --- | --- |
| `/start`, `/help` | Show help |
| `/status` | Show mode and trading settings |
| `/snipe <address>` | Buy (snipe) a token by address |
| `/positions` | List open positions |
| `/sell <address>` | Close a position |

## Configuration

All configuration is via environment variables — see [`.env.example`](.env.example).
Key settings: `TRADING_MODE` (`dry-run`\|`live`), `CHAIN`, `BUY_AMOUNT`,
`TAKE_PROFIT`, `STOP_LOSS`, `MAX_SLIPPAGE`, and `ALLOWED_USER_IDS` (access control).

## Development

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest
npm run build       # compile to dist/
```

## Architecture

- `src/config.ts` — validated configuration loader.
- `src/sniper/engine.ts` — trading engine (dry-run simulation + TP/SL logic).
- `src/sniper/simulatedFeed.ts` — deterministic price feed implementing `PriceFeed`.
- `src/commands.ts` — transport-agnostic command router.
- `src/bot.ts` — Telegraf transport wiring commands + access control.
- `src/index.ts` — entry point.
- `src/simulator.ts` — local end-to-end runner (no Telegram needed).

The command router is transport-agnostic, so the Telegram bot and the local
simulator exercise the exact same logic.

## Cloud Agent environment

This repo includes [`.cursor/environment.json`](.cursor/environment.json):
`install` runs `npm ci`, and a `bot` terminal runs `npm run dev`. Provide
`TELEGRAM_BOT_TOKEN` as a Cloud Agent secret to connect to Telegram.
