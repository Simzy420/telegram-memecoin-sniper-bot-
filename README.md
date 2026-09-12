# Big Brain Ape The MemeCoin Sniper

Telegram memecoin desk — Phase 1 scaffold.

One chat. Head ape plus five specialists: **Scout**, **Sniper**, **Pulse**, **Ledger**, **Shield**.

Bot: [https://t.me/Big_Brain_Ape_Bot](https://t.me/Big_Brain_Ape_Bot)

The homepage hero is the official full ape + chart artwork. Do not crop it. See [`assets/mascot/README.md`](./assets/mascot/README.md).

## Phase 1

Four-tap user flow:

1. Open the chat  
2. Generate wallet  
3. Fund ≥ $100 (Base / Ethereum / Binance / Monad / Robinhood / Solana)  
4. Activate  

Trading engine (specialist assignment, snipes, trailing take-profit) is **Phase 2**.

## Docs

- [FIRST_DRAFT.md](./FIRST_DRAFT.md) — architecture and scope  
- [WHAT_I_NEED_FROM_YOU.md](./WHAT_I_NEED_FROM_YOU.md) — checklist of inputs you provide  

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
# never commit secrets

docker compose up -d postgres   # optional local DB
npm install
npm run dev:bot
npm run dev:web
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:bot` | Run Telegram bot |
| `npm run dev:web` | Run docs site |
| `npm run build` | Build all packages |
| `npm test` | Hero/brand checks + welcome copy tests |
