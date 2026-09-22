# Data directory

Durable paper trading state lives in SQLite, not in git.

| What | Path |
| --- | --- |
| SQLite (journal rows, paper wallets, encrypted user wallets when Postgres is down) | `data/durable.sqlite`, or `$DATA_DIR/durable.sqlite` |
| Daily JSONL tape | `logs/days/YYYY-MM-DD/events.jsonl`, or `$DATA_DIR/logs/days/YYYY-MM-DD/events.jsonl` |
| CSV / JSONL export | `data/exports/` or `$EXPORT_DIR` |

On a Hugging Face Space the image sets `DATA_DIR=/data`. Mount persistent storage or a Storage Bucket at `/data` or a rebuild wipes the book. Do not commit the sqlite file or day folders.

# Trade archives

`trade-archives/` is the local UTC day-folder working copy (`YYYY-MM-DD`). It is **gitignored** so fills never land in this public repo.

The writer syncs/targets the private store https://github.com/Simzy420/bba-trade-archives for raw day folders. Schema stays in this sniper repo. Do not publish fills to the public dashboard.

See [`docs/TRADE_ARCHIVES.md`](../docs/TRADE_ARCHIVES.md). A committed EXAMPLE empty day lives at [`docs/examples/trade-archives/EXAMPLE-1970-01-01/`](../docs/examples/trade-archives/EXAMPLE-1970-01-01/).
