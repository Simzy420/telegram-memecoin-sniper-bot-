# Snipr (placeholder name)

Telegram memecoin agent — Phase 1 scaffold.

> **Product name TBD.** Set `BOT_NAME` in `.env`.  
> **This repo is separate from Big-Brain-Ape.**

## Phase 1

Four-tap user flow:

1. Start bot  
2. Generate wallet  
3. Fund ≥ $100 (Base / Ethereum / Binance / Monad / Robinhood / Solana)  
4. Activate bot  

Trading engine (memecoin snipes + trailing take-profit) is **Phase 2**.

## Docs

- [FIRST_DRAFT.md](./FIRST_DRAFT.md) — architecture and scope  
- [WHAT_I_NEED_FROM_YOU.md](./WHAT_I_NEED_FROM_YOU.md) — checklist of inputs you provide  
- [docs/TRADE_ARCHIVES.md](./docs/TRADE_ARCHIVES.md) — daily UTC trade-archive layout for backtests  


## Structure

```
apps/bot     Telegram bot (grammY + TypeScript)
apps/web     Landing + docs (Astro)
packages/shared   Chain config + shared types
```

## Quick start (local)

```bash
cp .env.example .env
# fill TELEGRAM_BOT_TOKEN, WALLET_ENCRYPTION_KEY, DATABASE_URL

docker compose up -d postgres   # optional local DB
npm install
npm run dev:bot
npm run dev:web
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev:bot` | Run Telegram bot |
| `npm run dev:web` | Run docs site |
| `npm run build` | Build all packages |
