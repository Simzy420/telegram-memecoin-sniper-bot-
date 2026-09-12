# Daily trade archives

**Product:** Big Brain Ape The MemeCoin Sniper  
**Head ape:** Big Brain Ape  
**Specialists (roles in one bot, not five bots):** Sniper · Scout · Guard · Arbiter · Router

This is the canonical layout and schema for a **calendar-day folder** that holds everything the specialists did that day — enough for Marketing and backtests to replay. The next UTC day is a new folder.

Timezone is **UTC**. Existing Phase 1 code already timestamps trades, analytics, and billing in UTC (`datetime.now(timezone.utc)`). Archives follow that. Folder names are `YYYY-MM-DD` in UTC. Rotation is at **UTC midnight**.

Do **not** use Perp / Swarm folder names.

---

## Layout (live data — gitignored)

```
data/trade-archives/YYYY-MM-DD/
  day-summary.json
  sniper/
    events.jsonl
  scout/
    events.jsonl
  guard/
    events.jsonl
  arbiter/
    events.jsonl
  router/
    events.jsonl
  combined-fills.csv
```

| Path | What it holds |
|------|----------------|
| `day-summary.json` | Counts, PnL, win/loss **per specialist** and **combined**. Zeros when nothing happened. |
| `{specialist}/events.jsonl` | Append-only JSON lines — every signal, check, decision, route, or fill that specialist produced. |
| `combined-fills.csv` | Flat fill tape (buy/sell attempts with outcome `filled` / `partial` / `failed`) for replay. |

Live fills stay out of git. `.gitignore` contains `data/trade-archives/`.

A committed **EXAMPLE** empty day (schema only, not production data) lives at:

`docs/examples/trade-archives/EXAMPLE-1970-01-01/`

Machine-readable JSON Schemas:

- [`docs/schemas/day-summary.schema.json`](./schemas/day-summary.schema.json)
- [`docs/schemas/archive-event.schema.json`](./schemas/archive-event.schema.json)

---

## Honesty (Phase 1)

The trading engine is **not live**. The writer still creates today's folder tree and writes an **empty / zero** `day-summary.json` plus a header-only `combined-fills.csv`.

It does **not** invent fills. Zero counts mean “no events were recorded,” not “we guessed.”

`day-summary.json` always includes:

```json
"honesty": {
  "engine_live": false,
  "invented_fills": false,
  "note": "Zero counts mean no fills were recorded. The writer never invents fills. Phase 1 trading engine is not live."
}
```

When a real engine later records events, set `engine_live: true` on the writer. Still never fabricate rows.

---

## Specialists

| Role | Folder | Typical events |
|------|--------|----------------|
| **Scout** | `scout/` | Token discovery / signal context (venue, liquidity, source). |
| **Guard** | `guard/` | Safety / rug checks (score, band, pass/fail reasons). |
| **Arbiter** | `arbiter/` | Go / no-go decisions (why a snipe was approved or blocked). |
| **Router** | `router/` | Venue / route choice (Jupiter, Raydium, Uniswap, …). |
| **Sniper** | `sniper/` | Execution: size, price, tx/order id, fees, outcome. |

Head ape (Big Brain Ape) is the product owner, not a sixth specialist folder.

---

## Event JSON (one line in `events.jsonl`)

Every event is one JSON object. Fields are enough to replay:

| Field | Type | Replay use |
|-------|------|------------|
| `event_id` | string | Stable join key across specialist files. |
| `timestamp` | string | UTC ISO-8601 with `Z`, e.g. `2026-09-12T16:00:00.000Z`. |
| `timezone` | `"UTC"` | Always UTC. |
| `specialist` | enum | `sniper` \| `scout` \| `guard` \| `arbiter` \| `router`. |
| `chain` | string | `solana`, `base`, `ethereum`, … |
| `venue` | string | DEX / aggregator (`jupiter`, `raydium`, `pumpfun`, `uniswap`, …). |
| `token.address` | string | Mint / contract. |
| `token.symbol` | string | Ticker at event time. |
| `token.name` | string | Optional display name. |
| `side` | string | `buy` \| `sell` \| `""` if not a trade. |
| `size` | number \| null | Order size. |
| `size_unit` | string | `SOL`, `ETH`, token units, … |
| `price` | number \| null | Execution / quote price. |
| `price_unit` | string | Default `USD`. |
| `tx_id` | string | On-chain signature / hash. |
| `order_id` | string | Internal order / position id. |
| `signal_context` | object | Scout payload: source, detected_at, liquidity_usd, parent event ids. |
| `guard_checks` | object | Guard payload: score, band, passed, reasons / per-check results. |
| `outcome` | string | See outcomes below. |
| `fees.amount` | number | Fee in `fees.asset`. |
| `fees.asset` | string | `SOL`, `ETH`, … |
| `fees.usd` | number | Fee in USD. |
| `pnl_usd` | number \| null | Realised PnL (sells). Omit / null on buys. |
| `notes` | string | Error text or human comment. Never secrets. |

**Outcomes**

- Fills (also written to `combined-fills.csv`): `filled`, `partial`, `failed`
- Non-fill specialist work: `signaled`, `checked`, `passed`, `blocked`, `approved`, `rejected`, `routed`, …

Empty string / `0` / `{}` means “not applicable.” Do not backfill guesses.

A fictional field walkthrough (not live data) is at [`docs/examples/trade-archives/SAMPLE-event.json`](./examples/trade-archives/SAMPLE-event.json).

---

## `combined-fills.csv`

Header (stable column order):

```
timestamp,event_id,specialist,chain,venue,token_address,token_symbol,side,size,size_unit,price,price_unit,tx_id,order_id,signal_context,guard_checks,outcome,fee_amount,fee_asset,fee_usd,pnl_usd,notes
```

`signal_context` and `guard_checks` are JSON objects encoded as CSV strings so one row stays one fill. Parse them back with `json.loads`.

Win / loss in the day summary counts **filled sells** with non-zero `pnl_usd` only. Buys are fills but not wins/losses.

---

## `day-summary.json`

```json
{
  "schema_version": "1.0.0",
  "product": "Big Brain Ape The MemeCoin Sniper",
  "head_ape": "Big Brain Ape",
  "date": "2026-09-12",
  "timezone": "UTC",
  "generated_at": "2026-09-12T16:00:00.000Z",
  "engine_live": false,
  "honesty": {
    "engine_live": false,
    "invented_fills": false,
    "note": "Zero counts mean no fills were recorded. The writer never invents fills. Phase 1 trading engine is not live."
  },
  "specialists": {
    "sniper":  { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "scout":   { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "guard":   { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "arbiter": { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "router":  { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 }
  },
  "combined": { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 }
}
```

`volume` is the sum of fill `size` values (see each fill's `size_unit`). `pnl_usd` / `fees_usd` are realised USD totals.

---

## Writer (bot hook)

Module: `src.archives.TradeArchiveWriter`

```python
from src.archives import TradeArchiveWriter

# Phase 1 — engine not live. Creates today's UTC folder + zero summary.
archives = TradeArchiveWriter(engine_live=False)
archives.ensure_day()

# Later, as real specialist events happen (never fabricate these):
archives.record_event({
    "specialist": "scout",
    "chain": "solana",
    "venue": "pumpfun",
    "token": {"address": "...", "symbol": "PEPE"},
    "outcome": "signaled",
    "signal_context": {"source": "pumpfun", "liquidity_usd": 12000},
})

archives.record_fill({
    "specialist": "sniper",
    "chain": "solana",
    "venue": "jupiter",
    "token": {"address": "...", "symbol": "PEPE"},
    "side": "buy",
    "size": 0.25,
    "size_unit": "SOL",
    "price": 0.00001234,
    "tx_id": "5x…",
    "order_id": "pos-…",
    "outcome": "filled",
    "guard_checks": {"score": 82, "passed": True},
    "fees": {"amount": 0.0001, "asset": "SOL", "usd": 0.015},
})
```

`TradeExecutor` accepts an optional `archives=` writer and records Sniper/Guard events only when `execute_buy` / `execute_sell` actually runs. Starting `main.py` or initialising the Telegram bot calls `ensure_day()` so the UTC folder exists even with no trades.

Env: `TRADE_ARCHIVE_ROOT` (default `data/trade-archives`).

---

## How Marketing / backtests should consume a day folder

1. **Pick a day.** Resolve `data/trade-archives/YYYY-MM-DD/` (UTC date of the session you care about). If the folder is missing, that day was never opened — treat as no archive, not as zeros you invent.
2. **Headline KPIs.** Read `day-summary.json`. Use `combined` for the ape-wide tape; use `specialists.*` to attribute Scout vs Guard vs Sniper work. Trust `honesty.engine_live` and `honesty.invented_fills`. If `fills == 0`, there is nothing to backtest — do not synthesise a tape.
3. **Replay fills.** Stream `combined-fills.csv` in timestamp order. That is the execution tape (size, price, side, tx/order id, fees, outcome).
4. **Rehydrate context.** For each fill, join `event_id` (and `order_id` / `tx_id`) to `{specialist}/events.jsonl`. Scout lines give signal context; Guard lines give the check set; Arbiter lines give the go/no-go; Router lines give the venue path; Sniper lines give the fill detail.
5. **Helper.** `from src.archives import load_day` returns `{summary, fills, events}` for one folder.
6. **EXAMPLE vs live.** Anything under `docs/examples/trade-archives/EXAMPLE-*` or with `"example": true` is schema illustration only. Never mix it into production backtests.
7. **Next day.** Close the previous folder (the writer flushes `day-summary.json` on rotate). Open `YYYY-MM-DD+1` at UTC midnight. Do not append Friday fills into Thursday's CSV.

---

## What is committed vs ignored

| Committed | Ignored |
|-----------|---------|
| This doc + JSON Schemas | `data/trade-archives/` (live fills) |
| `src/archives/` writer + reader | `.env` / secrets |
| `tests/test_trade_archive.py` | |
| `docs/examples/trade-archives/EXAMPLE-1970-01-01/` (empty EXAMPLE day) | |
