"""Daily trade-archive writer for Big Brain Ape The MemeCoin Sniper.

Call :class:`TradeArchiveWriter` as Scout / Sniper / Pulse / Ledger /
Shield events happen. Folders rotate at **UTC midnight**. Local working
copy: ``data/trade-archives/YYYY-MM-DD/`` (gitignored). The writer
targets the private store https://github.com/Simzy420/bba-trade-archives
for raw day folders. Schema stays in this sniper repo.

Honesty: if the trading engine is not live, :meth:`ensure_day` still
creates the folder tree and writes an empty/zero ``day-summary.json``.
The writer never invents fills.
"""
from __future__ import annotations

import csv
import json
import os
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional, Union

from src.archives.schema import (
    ARCHIVE_TIMEZONE,
    COMBINED_FILLS_FIELDS,
    COMBINED_FILLS_NAME,
    DAY_SUMMARY_NAME,
    EVENTS_FILENAME,
    FORBIDDEN_FOLDER_NAMES,
    HEAD_APE,
    PRIVATE_ARCHIVE_REPO,
    PRODUCT_NAME,
    SCHEMA_VERSION,
    SPECIALISTS,
    ArchiveEvent,
    empty_day_summary,
    empty_specialist_stats,
    utc_iso,
)

Clock = Callable[[], datetime]
EventInput = Union[ArchiveEvent, dict[str, Any]]

DEFAULT_ROOT = os.getenv("TRADE_ARCHIVE_ROOT", "data/trade-archives")


class TradeArchiveWriter:
    """Append-only writer that keeps one UTC calendar-day folder.

    Args:
        root: Archive root (default ``data/trade-archives`` or
            ``TRADE_ARCHIVE_ROOT``).
        clock: Injectable UTC clock (tests / midnight rotation).
        engine_live: Whether the trading engine is actually placing
            orders. Phase 1 is ``False`` — summaries stay at zero
            unless a caller records a real event.
        remote_store: Private GitHub home for raw day folders
            (default ``https://github.com/Simzy420/bba-trade-archives``).
            No credentials are stored here; sync uses the operator's
            existing git remotes.
    """

    def __init__(
        self,
        root: Union[str, Path] = DEFAULT_ROOT,
        *,
        clock: Optional[Clock] = None,
        engine_live: bool = False,
        remote_store: str = PRIVATE_ARCHIVE_REPO,
    ) -> None:
        self.root = Path(root)
        self.engine_live = engine_live
        self.remote_store = remote_store
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._current_date: Optional[date] = None
        self._day_dir: Optional[Path] = None
        self._summary: dict[str, Any] = {}

    # --------------------------- clock / dating --------------------------- #
    def now(self) -> datetime:
        stamp = self._clock()
        if stamp.tzinfo is None:
            return stamp.replace(tzinfo=timezone.utc)
        return stamp.astimezone(timezone.utc)

    def utc_today(self, when: Optional[datetime] = None) -> date:
        return (when or self.now()).astimezone(timezone.utc).date()

    # --------------------------- public API ------------------------------ #
    def ensure_day(self, when: Optional[datetime] = None) -> Path:
        """Create (or reopen) the UTC day folder. No fills are invented."""
        with self._lock:
            return self._switch_to(self.utc_today(when))

    def record_event(self, event: EventInput) -> ArchiveEvent:
        """Append one specialist event and refresh the day summary.

        Fills (buy/sell with outcome filled/partial/failed) are also
        appended to ``combined-fills.csv``. Scout / Pulse / Ledger /
        Shield signals increment event counts only unless they are fills.
        """
        payload = dict(event) if isinstance(event, dict) else event.model_dump()
        if payload.get("timestamp") in (None, ""):
            payload["timestamp"] = self.now()
        parsed = ArchiveEvent.model_validate(payload)
        if parsed.timestamp is None:
            parsed.timestamp = self.now()

        with self._lock:
            day_dir = self._switch_to(parsed.timestamp.date())
            self._append_jsonl(day_dir / parsed.specialist / EVENTS_FILENAME, parsed)
            if parsed.is_fill():
                self._append_fill(day_dir / COMBINED_FILLS_NAME, parsed)
            self._bump_summary(parsed)
            self._flush_summary()
        return parsed

    def record_fill(self, event: EventInput) -> ArchiveEvent:
        """Record a trade-like event. Sets outcome to ``filled`` if omitted."""
        payload = dict(event) if isinstance(event, dict) else event.model_dump()
        payload.setdefault("specialist", "sniper")
        payload.setdefault("outcome", "filled")
        return self.record_event(payload)

    def close(self) -> None:
        """Flush the current day-summary.json."""
        with self._lock:
            if self._day_dir is not None:
                self._flush_summary()

    def day_dir(self, when: Optional[datetime] = None) -> Path:
        return self.root / self.utc_today(when).isoformat()

    def sync_target(self) -> str:
        """Private repo the writer syncs/targets for raw day folders.

        Schema and EXAMPLE stay in this sniper repo. Fills must not go
        to the public dashboard. This returns the store URL only — it
        does not push and does not invent fills.
        """
        return self.remote_store

    # --------------------------- internals ------------------------------- #
    def _switch_to(self, day: date) -> Path:
        if day == self._current_date and self._day_dir is not None:
            return self._day_dir

        if self._current_date is not None and self._day_dir is not None:
            self._flush_summary()

        day_dir = self.root / day.isoformat()
        self._init_day_tree(day_dir, day.isoformat())
        self._current_date = day
        self._day_dir = day_dir
        self._summary = self._load_summary(day_dir, day.isoformat())
        return day_dir

    def _init_day_tree(self, day_dir: Path, date_key: str) -> None:
        day_dir.mkdir(parents=True, exist_ok=True)
        for name in SPECIALISTS:
            if name in FORBIDDEN_FOLDER_NAMES:
                raise RuntimeError(f"Refusing forbidden specialist folder {name!r}")
            spec_dir = day_dir / name
            spec_dir.mkdir(exist_ok=True)
            events_path = spec_dir / EVENTS_FILENAME
            if not events_path.exists():
                events_path.write_text("", encoding="utf-8")

        fills_path = day_dir / COMBINED_FILLS_NAME
        if not fills_path.exists():
            with fills_path.open("w", encoding="utf-8", newline="") as fh:
                csv.DictWriter(fh, fieldnames=list(COMBINED_FILLS_FIELDS)).writeheader()

        summary_path = day_dir / DAY_SUMMARY_NAME
        if not summary_path.exists():
            summary = empty_day_summary(
                date_key,
                engine_live=self.engine_live,
                generated_at=utc_iso(self.now()),
            )
            _atomic_write_json(summary_path, summary)

    def _load_summary(self, day_dir: Path, date_key: str) -> dict[str, Any]:
        path = day_dir / DAY_SUMMARY_NAME
        if not path.exists():
            return empty_day_summary(
                date_key,
                engine_live=self.engine_live,
                generated_at=utc_iso(self.now()),
            )
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict) or "specialists" not in data:
            return empty_day_summary(
                date_key,
                engine_live=self.engine_live,
                generated_at=utc_iso(self.now()),
            )
        data.setdefault("engine_live", self.engine_live)
        data.setdefault("honesty", {})
        data.setdefault("store", {
            "local_root": "data/trade-archives",
            "remote": self.remote_store,
            "note": (
                "Writer syncs/targets the private GitHub repo as the raw "
                "day-folder store. Schema stays in this sniper repo. "
                "Do not publish fills to the public dashboard."
            ),
        })
        data["honesty"]["invented_fills"] = False
        data["honesty"]["engine_live"] = self.engine_live
        return data

    def _bump_summary(self, event: ArchiveEvent) -> None:
        spec = event.specialist
        spec_stats = self._summary.setdefault("specialists", {}).setdefault(
            spec, empty_specialist_stats()
        )
        if not isinstance(spec_stats, dict):
            spec_stats = empty_specialist_stats()
            self._summary["specialists"][spec] = spec_stats
        combined = self._summary.setdefault("combined", empty_specialist_stats())

        for bucket in (spec_stats, combined):
            bucket["events"] = int(bucket.get("events", 0)) + 1

        if event.is_fill():
            size = float(event.size or 0.0)
            fees = float(event.fees.usd or 0.0)
            pnl = event.pnl_usd
            for bucket in (spec_stats, combined):
                bucket["fills"] = int(bucket.get("fills", 0)) + 1
                bucket["volume"] = round(float(bucket.get("volume", 0.0)) + size, 8)
                bucket["fees_usd"] = round(float(bucket.get("fees_usd", 0.0)) + fees, 8)
                if pnl is not None:
                    bucket["pnl_usd"] = round(float(bucket.get("pnl_usd", 0.0)) + pnl, 8)
                    if event.side == "sell" and event.outcome == "filled":
                        if pnl > 0:
                            bucket["wins"] = int(bucket.get("wins", 0)) + 1
                        elif pnl < 0:
                            bucket["losses"] = int(bucket.get("losses", 0)) + 1

        self._summary["generated_at"] = utc_iso(self.now())
        self._summary["engine_live"] = self.engine_live
        self._summary["schema_version"] = SCHEMA_VERSION
        self._summary["product"] = PRODUCT_NAME
        self._summary["head_ape"] = HEAD_APE
        self._summary["timezone"] = ARCHIVE_TIMEZONE
        store = self._summary.setdefault("store", {})
        store["remote"] = self.remote_store
        honesty = self._summary.setdefault("honesty", {})
        honesty["engine_live"] = self.engine_live
        honesty["invented_fills"] = False

    def _flush_summary(self) -> None:
        if self._day_dir is None:
            return
        _atomic_write_json(self._day_dir / DAY_SUMMARY_NAME, self._summary)

    def _append_jsonl(self, path: Path, event: ArchiveEvent) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(_event_to_json(event), ensure_ascii=False, separators=(",", ":"))
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    def _append_fill(self, path: Path, event: ArchiveEvent) -> None:
        row = _event_to_csv_row(event)
        write_header = not path.exists() or path.stat().st_size == 0
        with path.open("a", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(COMBINED_FILLS_FIELDS))
            if write_header:
                writer.writeheader()
            writer.writerow(row)


def _event_to_json(event: ArchiveEvent) -> dict[str, Any]:
    data = event.model_dump(mode="json")
    assert event.timestamp is not None
    data["timestamp"] = utc_iso(event.timestamp)
    data["timezone"] = ARCHIVE_TIMEZONE
    return data


def _event_to_csv_row(event: ArchiveEvent) -> dict[str, str]:
    assert event.timestamp is not None
    token = event.token
    return {
        "timestamp": utc_iso(event.timestamp),
        "event_id": event.event_id,
        "specialist": event.specialist,
        "chain": event.chain,
        "venue": event.venue,
        "token_address": token.address,
        "token_symbol": token.symbol,
        "side": event.side,
        "size": "" if event.size is None else str(event.size),
        "size_unit": event.size_unit,
        "price": "" if event.price is None else str(event.price),
        "price_unit": event.price_unit,
        "tx_id": event.tx_id,
        "order_id": event.order_id,
        "signal_context": json.dumps(event.signal_context, ensure_ascii=False, separators=(",", ":")),
        "shield_checks": json.dumps(event.shield_checks, ensure_ascii=False, separators=(",", ":")),
        "outcome": event.outcome,
        "fee_amount": str(event.fees.amount),
        "fee_asset": event.fees.asset,
        "fee_usd": str(event.fees.usd),
        "pnl_usd": "" if event.pnl_usd is None else str(event.pnl_usd),
        "notes": event.notes,
    }


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
