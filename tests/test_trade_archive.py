"""Tests for the daily trade-archive writer.

Uses a temp root and an injectable UTC clock. Never talks to a live
trading engine — any fill in these tests is an explicit test fixture.
"""
from __future__ import annotations

import csv
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.archives import (
    ARCHIVE_TIMEZONE,
    HEAD_APE,
    PRIVATE_ARCHIVE_REPO,
    PRODUCT_NAME,
    SPECIALISTS,
    ArchiveEvent,
    TradeArchiveWriter,
    load_day,
)
from src.archives.schema import COMBINED_FILLS_FIELDS, FORBIDDEN_FOLDER_NAMES, RETIRED_SPECIALISTS


REPO_ROOT = Path(__file__).resolve().parents[1]
EXAMPLE_DAY = REPO_ROOT / "docs" / "examples" / "trade-archives" / "EXAMPLE-1970-01-01"
SAMPLE_EVENT = REPO_ROOT / "docs" / "examples" / "trade-archives" / "SAMPLE-event.json"
GITIGNORE = REPO_ROOT / ".gitignore"


class MutableClock:
    def __init__(self, dt: datetime) -> None:
        self.dt = dt

    def __call__(self) -> datetime:
        return self.dt


class TradeArchiveWriterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(self._tmp_dir())
        self.clock = MutableClock(datetime(2026, 9, 12, 15, 30, tzinfo=timezone.utc))
        self.writer = TradeArchiveWriter(
            root=self.tmp, clock=self.clock, engine_live=False
        )

    def _tmp_dir(self) -> str:
        import tempfile

        self._tmpdir = tempfile.TemporaryDirectory()
        return self._tmpdir.name

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_ensure_day_creates_canonical_layout(self) -> None:
        day = self.writer.ensure_day()
        self.assertEqual(day.name, "2026-09-12")
        self.assertTrue((day / "day-summary.json").is_file())
        self.assertTrue((day / "combined-fills.csv").is_file())
        for name in SPECIALISTS:
            self.assertTrue((day / name).is_dir(), name)
            self.assertTrue((day / name / "events.jsonl").is_file(), name)
        self.assertEqual(SPECIALISTS, ("scout", "sniper", "pulse", "ledger", "shield"))
        self.assertEqual(self.writer.sync_target(), PRIVATE_ARCHIVE_REPO)
        for banned in FORBIDDEN_FOLDER_NAMES:
            self.assertFalse((day / banned).exists(), banned)

    def test_empty_day_is_zeros_and_does_not_invent_fills(self) -> None:
        day = self.writer.ensure_day()
        summary = json.loads((day / "day-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["timezone"], ARCHIVE_TIMEZONE)
        self.assertEqual(summary["product"], PRODUCT_NAME)
        self.assertEqual(summary["head_ape"], HEAD_APE)
        self.assertFalse(summary["engine_live"])
        self.assertFalse(summary["honesty"]["invented_fills"])
        self.assertEqual(summary["store"]["remote"], PRIVATE_ARCHIVE_REPO)
        self.assertEqual(summary["combined"]["fills"], 0)
        self.assertEqual(summary["combined"]["events"], 0)
        self.assertEqual(summary["combined"]["pnl_usd"], 0.0)
        for name in SPECIALISTS:
            self.assertEqual(summary["specialists"][name]["fills"], 0)
            self.assertEqual((day / name / "events.jsonl").read_text(encoding="utf-8"), "")

        with (day / "combined-fills.csv").open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        self.assertEqual(rows, [])

    def test_record_event_writes_specialist_jsonl(self) -> None:
        event = self.writer.record_event(
            {
                "specialist": "Scout",
                "chain": "solana",
                "venue": "pumpfun",
                "token": {"address": "So11111111111111111111111111111111111111112", "symbol": "TEST"},
                "outcome": "signaled",
                "signal_context": {"source": "pumpfun", "liquidity_usd": 9000},
            }
        )
        day = self.writer.day_dir()
        lines = (day / "scout" / "events.jsonl").read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(lines), 1)
        payload = json.loads(lines[0])
        self.assertEqual(payload["specialist"], "scout")
        self.assertEqual(payload["timezone"], "UTC")
        self.assertTrue(payload["timestamp"].endswith("Z"))
        self.assertEqual(payload["event_id"], event.event_id)
        self.assertEqual(payload["signal_context"]["source"], "pumpfun")

        summary = json.loads((day / "day-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["specialists"]["scout"]["events"], 1)
        self.assertEqual(summary["specialists"]["scout"]["fills"], 0)
        self.assertEqual(summary["combined"]["events"], 1)
        self.assertEqual(summary["combined"]["fills"], 0)
        with (day / "combined-fills.csv").open(encoding="utf-8", newline="") as fh:
            self.assertEqual(list(csv.DictReader(fh)), [])

    def test_record_fill_updates_csv_and_win_loss(self) -> None:
        self.writer.record_fill(
            {
                "specialist": "sniper",
                "chain": "solana",
                "venue": "jupiter",
                "token": {"address": "So11111111111111111111111111111111111111112", "symbol": "TEST"},
                "side": "buy",
                "size": 0.5,
                "size_unit": "SOL",
                "price": 0.01,
                "tx_id": "sig-buy",
                "order_id": "ord-1",
                "shield_checks": {"score": 80, "passed": True},
                "fees": {"amount": 0.0001, "asset": "SOL", "usd": 0.02},
            }
        )
        self.writer.record_fill(
            {
                "specialist": "sniper",
                "chain": "solana",
                "venue": "jupiter",
                "token": {"address": "So11111111111111111111111111111111111111112", "symbol": "TEST"},
                "side": "sell",
                "size": 0.5,
                "size_unit": "SOL",
                "price": 0.02,
                "tx_id": "sig-sell",
                "order_id": "ord-1",
                "pnl_usd": 12.5,
                "fees": {"amount": 0.0001, "asset": "SOL", "usd": 0.03},
            }
        )
        self.writer.record_fill(
            {
                "specialist": "sniper",
                "chain": "solana",
                "venue": "jupiter",
                "token": {"address": "So11111111111111111111111111111111111111112", "symbol": "LOSE"},
                "side": "sell",
                "size": 0.2,
                "size_unit": "SOL",
                "price": 0.001,
                "tx_id": "sig-lose",
                "order_id": "ord-2",
                "pnl_usd": -4.0,
                "fees": {"usd": 0.01},
            }
        )

        day = load_day(self.writer.day_dir())
        self.assertEqual(len(day["fills"]), 3)
        self.assertEqual(list(day["fills"][0].keys()), list(COMBINED_FILLS_FIELDS))
        self.assertEqual(day["fills"][0]["specialist"], "sniper")
        self.assertEqual(json.loads(day["fills"][0]["shield_checks"])["score"], 80)

        combined = day["summary"]["combined"]
        self.assertEqual(combined["fills"], 3)
        self.assertEqual(combined["wins"], 1)
        self.assertEqual(combined["losses"], 1)
        self.assertAlmostEqual(combined["pnl_usd"], 8.5)
        self.assertAlmostEqual(combined["fees_usd"], 0.06)
        self.assertAlmostEqual(combined["volume"], 1.2)
        self.assertEqual(day["summary"]["specialists"]["sniper"]["wins"], 1)
        self.assertEqual(day["summary"]["specialists"]["shield"]["fills"], 0)

    def test_utc_midnight_rotates_folder(self) -> None:
        self.writer.ensure_day()
        self.writer.record_event({"specialist": "pulse", "outcome": "taped", "venue": "jupiter"})
        first = self.writer.day_dir()
        self.assertEqual(first.name, "2026-09-12")

        self.clock.dt = datetime(2026, 9, 13, 0, 0, 1, tzinfo=timezone.utc)
        self.writer.record_event({"specialist": "shield", "outcome": "checked"})
        second = self.writer.day_dir()
        self.assertEqual(second.name, "2026-09-13")
        self.assertTrue(first.is_dir())
        self.assertTrue(second.is_dir())
        self.assertNotEqual(first, second)

        first_summary = json.loads((first / "day-summary.json").read_text(encoding="utf-8"))
        second_summary = json.loads((second / "day-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(first_summary["specialists"]["pulse"]["events"], 1)
        self.assertEqual(first_summary["specialists"]["shield"]["events"], 0)
        self.assertEqual(second_summary["specialists"]["shield"]["events"], 1)
        self.assertEqual(second_summary["specialists"]["pulse"]["events"], 0)

    def test_event_timestamp_selects_folder_not_clock(self) -> None:
        self.writer.record_event(
            {
                "specialist": "ledger",
                "outcome": "approved",
                "timestamp": "2026-09-11T23:59:59.000Z",
            }
        )
        self.assertTrue((self.tmp / "2026-09-11" / "ledger" / "events.jsonl").is_file())
        self.assertFalse((self.tmp / "2026-09-12" / "day-summary.json").exists())

    def test_rejects_retired_and_forbidden_names(self) -> None:
        for name in ("perp", "swarm", "Perps", "guard", "arbiter", "router", "Guard", "Arbiter", "Router"):
            with self.assertRaises(ValueError, msg=name):
                ArchiveEvent(specialist=name)
        for name in RETIRED_SPECIALISTS:
            self.assertIn(name, FORBIDDEN_FOLDER_NAMES)

    def test_committed_example_day_is_empty_and_marked(self) -> None:
        self.assertTrue(EXAMPLE_DAY.is_dir())
        loaded = load_day(EXAMPLE_DAY)
        self.assertTrue(loaded["summary"]["example"])
        self.assertIn("EXAMPLE", loaded["summary"]["example_note"])
        self.assertFalse(loaded["summary"]["honesty"]["invented_fills"])
        self.assertFalse(loaded["summary"]["engine_live"])
        self.assertEqual(loaded["summary"]["date"], "1970-01-01")
        self.assertEqual(loaded["summary"]["timezone"], "UTC")
        self.assertEqual(loaded["summary"]["store"]["remote"], PRIVATE_ARCHIVE_REPO)
        self.assertEqual(set(loaded["summary"]["specialists"]), set(SPECIALISTS))
        self.assertFalse((EXAMPLE_DAY / "guard").exists())
        self.assertFalse((EXAMPLE_DAY / "arbiter").exists())
        self.assertFalse((EXAMPLE_DAY / "router").exists())
        self.assertEqual(loaded["fills"], [])
        self.assertEqual(loaded["summary"]["combined"]["fills"], 0)
        for name in SPECIALISTS:
            self.assertEqual(loaded["events"][name], [])
            self.assertEqual(loaded["summary"]["specialists"][name]["events"], 0)

        sample = json.loads(SAMPLE_EVENT.read_text(encoding="utf-8"))
        self.assertTrue(sample["example"])
        self.assertIn("FICTIONAL", sample["example_note"])
        parsed = ArchiveEvent.model_validate(
            {k: v for k, v in sample.items() if k not in {"example", "example_note"}}
        )
        self.assertEqual(parsed.specialist, "sniper")
        self.assertTrue(parsed.is_fill())

    def test_gitignore_covers_live_archive_root(self) -> None:
        text = GITIGNORE.read_text(encoding="utf-8")
        self.assertIn("data/trade-archives/", text)
        self.assertNotIn("docs/examples/trade-archives", text)

    def test_timezone_is_utc_not_boise(self) -> None:
        self.assertEqual(ARCHIVE_TIMEZONE, "UTC")
        naive = ArchiveEvent(specialist="sniper", timestamp=datetime(2026, 9, 12, 12, 0))
        assert naive.timestamp is not None
        self.assertEqual(naive.timestamp.tzinfo, timezone.utc)
        boise = timezone(timedelta(hours=-6))
        converted = ArchiveEvent(
            specialist="sniper",
            timestamp=datetime(2026, 9, 12, 18, 0, tzinfo=boise),
        )
        assert converted.timestamp is not None
        self.assertEqual(converted.utc_date_key(), "2026-09-13")


if __name__ == "__main__":
    unittest.main()
