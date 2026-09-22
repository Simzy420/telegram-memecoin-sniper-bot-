---
title: Big Brain Ape The MemeCoin Sniper
emoji: 🦍
colorFrom: yellow
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

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

Sniper records a paper clip in Ledger. **This build never signs and never broadcasts.** Live mode arms only when `LIVE_TRADING` is the exact string `true`, `LIVE_TRADING_CONFIRM` is `I_UNDERSTAND`, and `WALLET_ENCRYPTION_KEY` is a real backed-up secret. Even then the live path is a stub: it runs safety checks and refuses the order. The unfinished Python executor returns the same refusal before any quote or signature.

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
- `/learn` — Ledger summarizes the journal (win rate, expectancy, Shield blocks, top and bottom names). Empty books stay empty.
- `/export` — CSV and JSONL of that chat's journal for a backtest
- `/help` — the same list inside Telegram

Wallet buttons (generate, deposit, export, activate) are still on the Start keyboard. Activate arms the Phase 1 flag after the portfolio minimum. It does not start live snipes.

## Deploy on Railway

Railway is the path to use. Long polling does not need a public webhook URL. The container listens on `PORT` (Railway sets it) at `/health` and polls Telegram. `GET /api/learn` is the journal poll when `LEARN_HTTP_SECRET` is set.

1. Push this repo and open [Railway](https://railway.app).
2. New project → Deploy from GitHub → this repository. Railway reads `railway.toml` and builds the `Dockerfile`.
3. Variables (no quotes, no committed values):
   - `TELEGRAM_BOT_TOKEN` — BotFather token for `@Big_Brain_Ape_Bot`
   - `BOT_NAME` — `Big Brain Ape The MemeCoin Sniper`
   - `LIVE_TRADING` — `false`
   - `LIVE_TRADING_CONFIRM` — leave empty
   - `OPENAI_API_KEY`, `HELIUS_API_KEY`, `ALCHEMY_API_KEY` — optional
   - `WALLET_ENCRYPTION_KEY` — 32+ random characters from `openssl rand -base64 32`, backed up offline, before anyone deposits
   - `DATABASE_URL` — optional Railway Postgres for wallet rows
   - `DATA_DIR` — optional volume path. SQLite defaults to `$DATA_DIR/durable.sqlite`
   - `LEARN_HTTP_SECRET` — optional bearer for `GET /api/learn`. Leave unset to keep the poll off (`503`)
4. Deploy. Logs should show `paper mode` and `polling`.
5. In Telegram, send `/start` to [@Big_Brain_Ape_Bot](https://t.me/Big_Brain_Ape_Bot). Hire, watch, and snipe `SLEEPAPE`. Ledger should show a paper clip and the wallet should be unchanged on-chain.

Do not set `LIVE_TRADING=true` expecting orders. Without the confirm phrase and a real encryption key the desk stays on paper. With all three set, the stub still refuses to sign.

## Paper → journal → learn → later live

1. **Paper.** Leave `LIVE_TRADING=false`. Hire the troop and snipe a drill name. Sniper writes a paper clip only after Shield. Prices that were not observed stay null. PnL stays 0 until a mark feed exists, and `/learn` does not treat those flat closes as wins.
2. **Journal.** Every Scout, Shield, Sniper, Pulse, and Ledger action appends one JSONL row under `logs/days/YYYY-MM-DD/events.jsonl` (or `$DATA_DIR/logs/days/...` when `DATA_DIR` or `/data` is in use). The same row is inserted into SQLite at `data/durable.sqlite` (or `$DATA_DIR/durable.sqlite`). Fields: timestamp, session id, user id, agent, action, symbol, chain, size, price, pnl, shield reasons, tags, `paper` or `live`. Private-key shaped text is dropped and not written.
3. **Learn.** `/learn` reads that chat's rows and reports win rate, expectancy, Shield block accuracy, and top/bottom symbols and strategies. A Shield block is scored only when a later realised close on that symbol has non-zero PnL. `/export` or `npm run export:journal` writes CSV and JSONL. Set `LEARN_NIGHTLY=true` and `LEARN_CHAT_ID` for an optional UTC midnight summary of the previous day. An empty day sends nothing.

   `GET /api/learn` (alias `GET /learn`) returns that same summary as JSON. Send `Authorization: Bearer <LEARN_HTTP_SECRET>`. An unset or blank secret answers `503` with a short plain message. A missing or wrong bearer answers `401`. The secret is not logged or echoed. Optional query `userId` filters to that Telegram user, the same way in-chat `/learn` does. Omit `userId` for an operator digest of every journal row (`scope` is `all`, `userId` is null). The body is `{ ok, empty, text, summary, scope, userId, generatedAt }`. `text` is the exact `/learn` summary. `empty` is true when there are no rows, including when the journal is not being persisted. Grok Bot can schedule a poll against `https://simzy-big-brain-ape-bot.hf.space/api/learn`.

4. **Later live.** Arming requires `LIVE_TRADING=true`, `LIVE_TRADING_CONFIRM=I_UNDERSTAND`, and a backed-up `WALLET_ENCRYPTION_KEY`. The order path still returns `broadcast: false` and no transaction id. Do not point real size at this build.

Paper wallets (cash, open clips) are in the same SQLite file, so a process restart keeps the book. Encrypted on-chain wallet rows stay in Postgres when `DATABASE_URL` connects. When Postgres is down they fall back to the same SQLite file. The ciphertext is useless without the encryption key, and the key is never printed.

## Hugging Face Space

Space: [Simzy/big-brain-ape-bot](https://huggingface.co/spaces/Simzy/big-brain-ape-bot). Docker, port 7860. Keep the hardware on a non-sleeping CPU upgrade so the bot stays up.

The image sets `DATA_DIR=/data`, `PORT=7860`, and `LIVE_TRADING=false`. It does not set an encryption key or the confirm phrase.

| Variable | Space value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token. Never commit it. |
| `BOT_NAME` | `Big Brain Ape The MemeCoin Sniper` |
| `LIVE_TRADING` | `false` |
| `LIVE_TRADING_CONFIRM` | empty |
| `WALLET_ENCRYPTION_KEY` | backed-up 32+ character secret, Space secret, not the README |
| `DATA_DIR` | `/data` |
| `WEBHOOK_URL` | `https://<space-host>/telegram/webhook` |
| `WEBHOOK_SECRET` | optional, Space secret |
| `LEARN_NIGHTLY` | `false` unless you want the midnight summary |
| `LEARN_CHAT_ID` | operator chat, only if nightly is on |
| `LEARN_HTTP_SECRET` | Space secret. Bearer token for `GET /api/learn`. Leave unset to keep the poll off (`503`) |
| `OPENAI_API_KEY`, `HELIUS_API_KEY`, `ALCHEMY_API_KEY` | optional |

`/data` is ephemeral until storage is attached. A coordinator with a Hugging Face token can attach it. Do not put the token in the repo.

Legacy persistent disk (older Spaces), mounted at `/data`:

```text
POST https://huggingface.co/api/spaces/Simzy/big-brain-ape-bot/storage
Authorization: Bearer $HF_TOKEN
{"tier":"small"}
```

Current Storage Bucket volume, also mounted at `/data`:

```python
from huggingface_hub import HfApi, Volume

HfApi().set_space_volumes(
    "Simzy/big-brain-ape-bot",
    [Volume(type="bucket", source="Simzy/<bucket>", mount_path="/data")],
)
```

Create the bucket first. This environment does not call that API. After merge, redeploy the Space from this Dockerfile so the journal path and webhook server are what the Space runs.

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
| `npm test` | Hero checks, welcome copy, desk, journal, and handler smoke tests |
| `npm run export:journal` | Write CSV and JSONL for the on-disk journal |
| `npm run start -w @snipr/bot` | Run the compiled bot (used in Docker) |
