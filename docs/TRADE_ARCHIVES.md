# Daily trade archives

**Product:** Big Brain Ape The MemeCoin Sniper  
**Head ape:** Big Brain Ape  
**Specialists (roles in one bot, not five bots):** Scout · Sniper · Pulse · Ledger · Shield

This is the canonical layout and schema for a **calendar-day folder** that holds everything the specialists did that day — enough for Marketing and backtests to replay. The next UTC day is a new folder.

Timezone is **UTC**. Existing Phase 1 code already timestamps trades, analytics, and billing in UTC (`datetime.now(timezone.utc)`). Archives follow that. Folder names are `YYYY-MM-DD` in UTC. Rotation is at **UTC midnight**.

Do **not** use retired Pack 1 names (Guard / Arbiter / Router) or Perp / Swarm folder names. The writer rejects them.

---

## Store vs schema

| What | Where |
|------|--------|
| **Schema, writer, EXAMPLE, tests** | This public sniper repo |
| **Raw live day folders / fills** | Private GitHub home: [Simzy420/bba-trade-archives](https://github.com/Simzy420/bba-trade-archives) |

The writer writes a local working copy under `data/trade-archives/` (gitignored in this repo) and **syncs/targets** `https://github.com/Simzy420/bba-trade-archives` as the raw day-folder store. Do **not** put fills in the public dashboard. Do not commit secrets or live fills here.

`TradeArchiveWriter.sync_target()` returns that private repo URL. It does not push credentials and it never invents fills.

---

## Layout (live data — gitignored locally, stored privately)

```
data/trade-archives/YYYY-MM-DD/
  day-summary.json
  scout/
    events.jsonl
  sniper/
    events.jsonl
  pulse/
    events.jsonl
  ledger/
    events.jsonl
  shield/
    events.jsonl
  combined-fills.csv
```

| Path | What it holds |
|------|----------------|
| `day-summary.json` | Counts, PnL, win/loss **per specialist** and **combined**. Zeros when nothing happened. Ledger's day log roll-up. |
| `{specialist}/events.jsonl` | Append-only JSON lines — everything that specialist did that day. |
| `combined-fills.csv` | Flat fill tape (buy/sell attempts with outcome `filled` / `partial` / `failed`) for replay. Ledger fill tape. |

Live fills stay out of this repo. `.gitignore` contains `data/trade-archives/`.

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

## Specialists (Pack 2 lock)

| Role | Folder | Job |
|------|--------|-----|
| **Scout** | `scout/` | Finds pairs / setups. |
| **Sniper** | `sniper/` | Memecoin entries. |
| **Pulse** | `pulse/` | Rapid day trader / tape. |
| **Ledger** | `ledger/` | Positions, fills, day log. |
| **Shield** | `shield/` | Risk filters before entry. |

Head ape (Big Brain Ape) is the product owner, not a sixth specialist folder.

Retired (rejected by the writer): Guard → Shield, Arbiter → Ledger, Router → Pulse.

---

## Event JSON (one line in `events.jsonl`)

Every event is one JSON object. Fields are enough to replay:

| Field | Type | Replay use |
|-------|------|------------|
| `event_id` | string | Stable join key across specialist files. |
| `timestamp` | string | UTC ISO-8601 with `Z`, e.g. `2026-09-12T16:00:00.000Z`. |
| `timezone` | `"UTC"` | Always UTC. |
| `specialist` | enum | `scout` \| `sniper` \| `pulse` \| `ledger` \| `shield`. |
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
| `shield_checks` | object | Shield payload: score, band, passed, reasons / per-check results. |
| `outcome` | string | See outcomes below. |
| `fees.amount` | number | Fee in `fees.asset`. |
| `fees.asset` | string | `SOL`, `ETH`, … |
| `fees.usd` | number | Fee in USD. |
| `pnl_usd` | number \| null | Realised PnL (sells). Omit / null on buys. |
| `notes` | string | Error text or human comment. Never secrets. |

**Outcomes**

- Fills (also written to `combined-fills.csv`): `filled`, `partial`, `failed`
- Non-fill specialist work: `signaled`, `checked`, `passed`, `blocked`, `approved`, `rejected`, `taped`, …

Empty string / `0` / `{}` means “not applicable.” Do not backfill guesses.

A fictional field walkthrough (not live data) is at [`docs/examples/trade-archives/SAMPLE-event.json`](./examples/trade-archives/SAMPLE-event.json).

---

## `combined-fills.csv`

Header (stable column order):

```
timestamp,event_id,specialist,chain,venue,token_address,token_symbol,side,size,size_unit,price,price_unit,tx_id,order_id,signal_context,shield_checks,outcome,fee_amount,fee_asset,fee_usd,pnl_usd,notes
```

`signal_context` and `shield_checks` are JSON objects encoded as CSV strings so one row stays one fill. Parse them back with `json.loads`.

Win / loss in the day summary counts **filled sells** with non-zero `pnl_usd` only. Buys are fills but not wins/losses.

---

## `day-summary.json`

```json
{
  "schema_version": "1.1.0",
  "product": "Big Brain Ape The MemeCoin Sniper",
  "head_ape": "Big Brain Ape",
  "date": "2026-09-12",
  "timezone": "UTC",
  "generated_at": "2026-09-12T16:00:00.000Z",
  "engine_live": false,
  "store": {
    "local_root": "data/trade-archives",
    "remote": "https://github.com/Simzy420/bba-trade-archives",
    "note": "Writer syncs/targets the private GitHub repo as the raw day-folder store. Schema and EXAMPLE stay in the public sniper repo. Do not publish fills to the public dashboard."
  },
  "honesty": {
    "engine_live": false,
    "invented_fills": false,
    "note": "Zero counts mean no fills were recorded. The writer never invents fills. Phase 1 trading engine is not live."
  },
  "specialists": {
    "scout":  { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "sniper": { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "pulse":  { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "ledger": { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 },
    "shield": { "events": 0, "fills": 0, "wins": 0, "losses": 0, "pnl_usd": 0.0, "fees_usd": 0.0, "volume": 0.0 }
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
archives.sync_target()  # https://github.com/Simzy420/bba-trade-archives

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
    "shield_checks": {"score": 82, "passed": True},
    "fees": {"amount": 0.0001, "asset": "SOL", "usd": 0.015},
})
```

`TradeExecutor` accepts an optional `archives=` writer and records Sniper/Shield events only when `execute_buy` / `execute_sell` actually runs. Starting `main.py` or initialising the Telegram bot calls `ensure_day()` so the UTC folder exists even with no trades.

Env:

- `TRADE_ARCHIVE_ROOT` (default `data/trade-archives`) — local working copy
- `TRADE_ARCHIVE_REMOTE` (default `https://github.com/Simzy420/bba-trade-archives`) — private store
- `TRADE_ENGINE_LIVE` (default `false`)

---

## How Marketing / backtests should consume a day folder

1. **Pick a day from the private store.** Clone or pull [bba-trade-archives](https://github.com/Simzy420/bba-trade-archives) (not the public dashboard). Resolve `YYYY-MM-DD/` (UTC). Locally the writer also keeps `data/trade-archives/YYYY-MM-DD/` as a working copy. If the folder is missing, that day was never opened — treat as no archive, not as zeros you invent.
2. **Headline KPIs.** Read `day-summary.json`. Use `combined` for the ape-wide tape; use `specialists.*` to attribute Scout / Sniper / Pulse / Ledger / Shield. Trust `honesty.engine_live` and `honesty.invented_fills`. If `fills == 0`, there is nothing to backtest — do not synthesise a tape.
3. **Replay fills.** Stream `combined-fills.csv` in timestamp order (Ledger fill tape: size, price, side, tx/order id, fees, outcome).
4. **Rehydrate context.** For each fill, join `event_id` (and `order_id` / `tx_id`) to `{specialist}/events.jsonl`. Scout = setups; Sniper = entries; Pulse = tape; Ledger = positions / day log; Shield = pre-entry risk filters.
5. **Helper.** `from src.archives import load_day` returns `{summary, fills, events}` for one folder.
6. **EXAMPLE vs live.** Anything under `docs/examples/trade-archives/EXAMPLE-*` or with `"example": true` is schema illustration only. Never mix it into production backtests.
7. **Next day.** Close the previous folder (the writer flushes `day-summary.json` on rotate). Open `YYYY-MM-DD+1` at UTC midnight. Do not append Friday fills into Thursday's CSV.

---

## What is committed vs ignored

| Committed (this repo) | Ignored / private |
|-----------------------|-------------------|
| This doc + JSON Schemas | `data/trade-archives/` (live fills) |
| `src/archives/` writer + reader | Raw day folders in [bba-trade-archives](https://github.com/Simzy420/bba-trade-archives) |
| `tests/test_trade_archive.py` | `.env` / secrets |
| `docs/examples/trade-archives/EXAMPLE-1970-01-01/` (empty EXAMPLE day) | Public dashboard (no fills) |
