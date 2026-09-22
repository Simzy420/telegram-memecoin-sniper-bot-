# Big Brain Ape The MemeCoin Sniper

Telegram memecoin desk. One BotFather bot, one chat.

**Big Brain Ape** is the boss. Five specialists answer in that same chat, under their own names:

| Specialist | Job |
| --- | --- |
| Scout | Finds pairs and surfaces candidates |
| Sniper | Entry timing. Paper fills only in this build |
| Pulse | Momentum and tape commentary |
| Ledger | Positions, PnL, trade-journal updates |
| Shield | Honeypot, tax, and liquidity checklist |

Bot: [https://t.me/Big_Brain_Ape_Bot](https://t.me/Big_Brain_Ape_Bot) (`@Big_Brain_Ape_Bot`)

This product is separate from the Hyperliquid desk. Do not mix those tokens or that branding in here.

The homepage hero is the official full ape + chart artwork. Do not crop it. See [`assets/mascot/README.md`](./assets/mascot/README.md).

The runnable bot is the TypeScript grammY app in `apps/bot`. `main.py` is an unfinished Python stub. Do not start that for the desk.

## Paper mode

`LIVE_TRADING` defaults to `false`. Scout can show drill names (`PAPERPEPE`, `RUGPUP`, `SLEEPAPE`) or a read-only DexScreener profile feed. With `HELIUS_API_KEY`, Shield also reads Solana mint and freeze authorities. With `ALCHEMY_API_KEY`, Shield checks that an EVM contract has bytecode.

Sniper records a paper clip in Ledger. **This build never signs and never broadcasts**, including when `LIVE_TRADING=true`. That flag only changes the warning so a live request cannot silently turn into a transaction. Chain snipes stay a later engine.

`OPENAI_API_KEY` is optional. It may rewrite free-form chat color. Fills, verdicts, and the journal do not depend on it.

## Run locally

```bash
cp .env.example .env
# Put the BotFather token in TELEGRAM_BOT_TOKEN.
# Leave LIVE_TRADING=false. Do not commit .env.

npm install
npm run dev:bot
```

Postgres is optional. `docker compose up -d postgres` persists generated wallets. Without it, the bot still polls: the paper desk works, and wallet rows stay in memory until restart.

```bash
npm run dev:web   # landing + docs on http://localhost:4321
npm test
```

## Talk to the team

Open [@Big_Brain_Ape_Bot](https://t.me/Big_Brain_Ape_Bot) and tap Start. One chat. Messages are tagged with the speaker:

1. **Hire Team** (`/hire`) — seats Scout, Sniper, Pulse, Ledger, and Shield.
2. **Watch Tape** (`/watch`) — Scout lists names, Shield checks the first, Pulse reads the print.
3. **Desk Status** (`/status`) — who is hired, paper cash, and whether provider keys are set. Values are never printed.

Then talk in plain text:

- `scout` or `/scout` — candidates
- `shield check SLEEPAPE` or `/shield` — checklist
- `snipe SLEEPAPE` — paper entry after Shield. `RUGPUP` is refused.
- `ledger` or `/paper` — the book
- `close SLEEPAPE` — flat paper exit (no mark-to-market feed yet)
- `/pulse` — tape read
- `/help` — the same list inside Telegram

Wallet buttons (generate, deposit, export, activate) are still on the Start keyboard. Activate arms the Phase 1 flag after the portfolio minimum. It does not start live snipes.

## Deploy on Railway

Railway is the path to use. Long polling does not need a public webhook URL. The container listens on `PORT` (Railway sets it) at `/health` and polls Telegram.

1. Push this repo and open [Railway](https://railway.app).
2. New project → Deploy from GitHub → this repository. Railway reads `railway.toml` and builds the `Dockerfile`.
3. Variables (no quotes, no committed values):
   - `TELEGRAM_BOT_TOKEN` — BotFather token for `@Big_Brain_Ape_Bot`
   - `BOT_NAME` — `Big Brain Ape The MemeCoin Sniper`
   - `LIVE_TRADING` — `false`
   - `OPENAI_API_KEY`, `HELIUS_API_KEY`, `ALCHEMY_API_KEY` — optional
   - `WALLET_ENCRYPTION_KEY` — long random string before anyone deposits
   - `DATABASE_URL` — optional Railway Postgres for wallet rows
4. Deploy. Logs should show `paper mode` and `polling`.
5. In Telegram, send `/start` to [@Big_Brain_Ape_Bot](https://t.me/Big_Brain_Ape_Bot). Hire, watch, and snipe `SLEEPAPE`. Ledger should show a paper clip and the wallet should be unchanged on-chain.

Do not set `LIVE_TRADING=true` expecting orders. The process will warn and keep the desk on paper.

## Wallet path

1. Open the chat
2. Generate wallet
3. Fund at least $100 (Base, Ethereum, Binance, Monad, Robinhood, or Solana)
4. Activate

That marks the agent armed. Trading stays paper until a future broadcaster exists.

## Docs

- [FIRST_DRAFT.md](./FIRST_DRAFT.md) — original Phase 1 scope
- [WHAT_I_NEED_FROM_YOU.md](./WHAT_I_NEED_FROM_YOU.md) — inputs checklist
- [docs/TRADE_ARCHIVES.md](./docs/TRADE_ARCHIVES.md) — UTC trade-archive layout

## Structure

```
apps/bot          Telegram bot (grammY + TypeScript) — run this
apps/web          Landing + docs (Astro)
packages/shared   Chain config + shared types
main.py           Unfinished Python stub — not the desk
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:bot` | Build shared types and run the Telegram bot |
| `npm run dev:web` | Run the docs site |
| `npm run build` | Build shared, bot, and web |
| `npm test` | Hero checks, welcome copy, desk, and handler smoke tests |
| `npm run start -w @snipr/bot` | Run the compiled bot (used in Docker) |
