"""Read a UTC day folder for Marketing / backtests.

A day folder is the unit of replay: ``day-summary.json`` for roll-ups,
``combined-fills.csv`` for the fill tape, and ``{specialist}/events.jsonl``
for Scout / Sniper / Pulse / Ledger / Shield context.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from src.archives.schema import (
    COMBINED_FILLS_NAME,
    DAY_SUMMARY_NAME,
    EVENTS_FILENAME,
    SPECIALISTS,
)


def load_day(day_dir: str | Path) -> dict[str, Any]:
    """Load summary, fills, and per-specialist events from one day folder."""
    root = Path(day_dir)
    if not root.is_dir():
        raise FileNotFoundError(f"Day folder not found: {root}")

    summary_path = root / DAY_SUMMARY_NAME
    summary: dict[str, Any] = {}
    if summary_path.exists():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))

    fills_path = root / COMBINED_FILLS_NAME
    fills: list[dict[str, str]] = []
    if fills_path.exists() and fills_path.stat().st_size > 0:
        with fills_path.open(encoding="utf-8", newline="") as fh:
            fills = list(csv.DictReader(fh))

    events: dict[str, list[dict[str, Any]]] = {}
    for name in SPECIALISTS:
        path = root / name / EVENTS_FILENAME
        rows: list[dict[str, Any]] = []
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        events[name] = rows

    return {
        "path": str(root),
        "date": summary.get("date") or root.name,
        "timezone": summary.get("timezone", "UTC"),
        "summary": summary,
        "fills": fills,
        "events": events,
    }
