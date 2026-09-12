# EXAMPLE empty day — 1970-01-01 (UTC)

**THIS IS AN EXAMPLE.** It is not live fills and must not be used as production backtest input.

It shows the canonical empty day the writer creates when the trading engine is not live (Phase 1):

- `day-summary.json` — all zeros, `"example": true`, `honesty.invented_fills: false`
- specialist folders `sniper/` `scout/` `guard/` `arbiter/` `router/` with empty `events.jsonl`
- `combined-fills.csv` — header only, no rows

Live archives belong under `data/trade-archives/YYYY-MM-DD/` (gitignored).
