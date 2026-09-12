# What I need from you

Items marked **blocker** are required before a working Phase 1 demo on real Telegram / real chains. Everything else can wait or use placeholders.

---

## Blockers (needed to run Phase 1 for real)

1. **Product name** — ✅ **Big Brain Ape The MemeCoin Sniper**. Bot: [@Big_Brain_Ape_Bot](https://t.me/Big_Brain_Ape_Bot).
2. **Telegram bot token** — create via [@BotFather](https://t.me/BotFather); send me the token (or put it in secrets / `.env`, never commit it).
3. **Telegram bot username** — e.g. `@YourName_Bot` (for deep links on the website).
4. **New GitHub repository** — ✅ Received: https://github.com/Simzy420/telegram-memecoin-sniper-bot- — push blocked until Cursor GitHub App has write access to that repo.
5. **Master encryption secret** — long random string used to encrypt stored private keys (`WALLET_ENCRYPTION_KEY`). You can generate one; I can also generate and you store it safely.

---

## Needed soon (before mainnet funding tests)

6. **RPC endpoints** for:
   - Ethereum
   - Base
   - BNB Smart Chain
   - Monad
   - Robinhood Chain (confirm this is the correct “Robinhood” network from the screenshots)
   - Solana  
   Free public RPCs work for early tests; Alchemy / QuickNode / Helius recommended before real money.
7. **Confirm Robinhood network** — chain id, native token (screenshot shows ETH), and official RPC/docs link.
8. **Confirm Monad** — mainnet vs testnet for Phase 1; RPC URL; native token symbol `MON`.
9. **Minimum fund amount** — confirm **$100 USD** (or change it).
10. **Domain** for the docs site (optional for first deploy; can use `*.vercel.app` / similar first).

---

## Product / copy decisions (can iterate)

11. **Brand voice** — serious, meme-heavy, or mixed (reference bot is meme-heavy).
12. **Telegram channel URL** — for the Channel link in the bot.
13. **Promo rules** — “48 hours no fees”: confirm keep for launch messaging (fees themselves are Phase 2).
14. **Support contact** — email / Telegram handle for docs footer.
15. **Logo / colors** — optional; Phase 1 site can ship without a custom logo.

---

## Legal / ops (you own these; I will not give legal advice)

16. **Jurisdiction / ToS / risk disclaimer** — memecoin automation + custodial-style keys is high risk. Plan for clear “you can lose everything” docs before public users.
17. **Who may use it** — geo restrictions, 18+, etc. (text for docs).
18. **Where you will host** — VPS, Railway, Fly, etc. (I can target Docker either way).

---

## Phase 2 only (do not need yet)

- Which memecoin venues to snipe first (e.g. Pump.fun, Raydium, Uniswap on Base, etc.)
- Max buy size, default slippage, default trailing-TP / stop-loss parameters
- Fee % after promo window
- Whether “Import a Wallet” is required at launch

---

## How to send secrets safely

- Prefer GitHub Actions secrets / host env vars / a password manager share.
- Do **not** paste private keys or bot tokens into public issues or committed files.
- For this Cursor cloud chat: use the environment secrets UI when possible.

---

## Suggested order

1. Pick a temporary or final **name**
2. Create **BotFather** bot → token + username
3. Create **empty GitHub repo** → send URL
4. Confirm **$100** min + **Robinhood / Monad** network details
5. I wire env, deploy Phase 1, you test the 4-button flow on Telegram
