import json
import os
import unittest
import uuid

from fastapi.testclient import TestClient

from main import RATE, app, refresh_file, snapshot_file


SAMPLE = {
    "updatedAt": "2026-09-28T15:04:00Z",
    "account": {"label": "", "last4": "999988886740", "accountNumber": "1234999988886740"},
    "totalValue": 118532.25,
    "equityValue": 175464.27,
    "cryptoValue": 26130.89,
    "cash": -83062.91,
    "currency": "USD",
    "positions": [
        {
            "symbol": "pltr",
            "quantity": 149.998,
            "avgCost": 142.02,
            "price": 0,
            "marketValue": 0,
            "dayChangePct": None,
        }
    ],
}


class RobinhoodBridgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env = {
            "ROBINHOOD_BRIDGE_SECRET": os.environ.get("ROBINHOOD_BRIDGE_SECRET"),
            "CHAT_BRIDGE_SECRET": os.environ.get("CHAT_BRIDGE_SECRET"),
        }
        os.environ.pop("ROBINHOOD_BRIDGE_SECRET", None)
        os.environ["CHAT_BRIDGE_SECRET"] = "chat-secret-value"
        RATE.clear()
        self._wipe_files()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        self._wipe_files()
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _wipe_files(self) -> None:
        for path in (snapshot_file(), refresh_file()):
            if path.exists():
                path.unlink()
            tmp = path.with_suffix(path.suffix + ".tmp")
            if tmp.exists():
                tmp.unlink()

    def test_get_empty_snapshot_is_public(self) -> None:
        res = self.client.get("/api/robinhood")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"snapshot": None, "refreshPending": False})
        self.assertEqual(res.headers.get("cache-control"), "no-store")

    def test_post_requires_bearer_and_masks_account(self) -> None:
        denied = self.client.post("/api/robinhood", json=SAMPLE)
        self.assertEqual(denied.status_code, 401)
        wrong = self.client.post(
            "/api/robinhood",
            json=SAMPLE,
            headers={"Authorization": "Bearer nope"},
        )
        self.assertEqual(wrong.status_code, 401)

        ok = self.client.post(
            "/api/robinhood",
            json=SAMPLE,
            headers={"Authorization": "Bearer chat-secret-value"},
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["updatedAt"], "2026-09-28T15:04:00Z")

        got = self.client.get("/api/robinhood")
        snapshot = got.json()["snapshot"]
        self.assertEqual(snapshot["account"], {"label": "Individual", "last4": "6740"})
        self.assertNotIn("accountNumber", snapshot["account"])
        self.assertNotIn("1234999988886740", got.text)
        self.assertEqual(snapshot["totalValue"], 118532.25)
        self.assertEqual(snapshot["positions"][0]["symbol"], "PLTR")
        self.assertEqual(snapshot["positions"][0]["price"], 0)

    def test_post_replaces_snapshot(self) -> None:
        headers = {"Authorization": "Bearer chat-secret-value"}
        self.client.post("/api/robinhood", json=SAMPLE, headers=headers)
        replaced = dict(SAMPLE)
        replaced["totalValue"] = 10
        replaced["positions"] = []
        res = self.client.post("/api/robinhood", json=replaced, headers=headers)
        self.assertEqual(res.status_code, 200)
        snapshot = self.client.get("/api/robinhood").json()["snapshot"]
        self.assertEqual(snapshot["totalValue"], 10)
        self.assertEqual(snapshot["positions"], [])

    def test_dedicated_secret_replaces_chat_secret(self) -> None:
        os.environ["ROBINHOOD_BRIDGE_SECRET"] = "rh-secret-value"
        chat = self.client.post(
            "/api/robinhood",
            json=SAMPLE,
            headers={"Authorization": "Bearer chat-secret-value"},
        )
        self.assertEqual(chat.status_code, 401)
        ok = self.client.post(
            "/api/robinhood",
            json=SAMPLE,
            headers={"Authorization": "Bearer rh-secret-value"},
        )
        self.assertEqual(ok.status_code, 200)

    def test_missing_secret_is_not_open(self) -> None:
        os.environ.pop("ROBINHOOD_BRIDGE_SECRET", None)
        os.environ.pop("CHAT_BRIDGE_SECRET", None)
        res = self.client.post("/api/robinhood", json=SAMPLE, headers={"Authorization": "Bearer anything"})
        self.assertEqual(res.status_code, 500)

    def test_chat_reply_still_uses_chat_secret(self) -> None:
        os.environ["ROBINHOOD_BRIDGE_SECRET"] = "rh-secret-value"
        body = {
            "sessionId": str(uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
            "clientMsgId": "cmt_test",
            "botId": "chief",
            "text": "ok",
            "status": "final",
        }
        denied = self.client.post(
            "/api/chat/reply",
            json=body,
            headers={"Authorization": "Bearer rh-secret-value"},
        )
        self.assertEqual(denied.status_code, 401)
        ok = self.client.post(
            "/api/chat/reply",
            json=body,
            headers={"Authorization": "Bearer chat-secret-value"},
        )
        self.assertEqual(ok.status_code, 200)
        polled = self.client.get(f"/api/chat?sessionId={body['sessionId']}")
        self.assertEqual(polled.status_code, 200)
        self.assertEqual(polled.json()["messages"][-1]["text"], "ok")

    def test_refresh_request_is_public_and_rate_limited_per_ip(self) -> None:
        os.environ.pop("ROBINHOOD_BRIDGE_SECRET", None)
        os.environ.pop("CHAT_BRIDGE_SECRET", None)
        first = self.client.post("/api/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.10"})
        self.assertEqual(first.status_code, 200)
        body = first.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["refreshPending"])
        self.assertRegex(body["requestedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertEqual(first.headers.get("cache-control"), "no-store")
        stored = json.loads(refresh_file().read_text(encoding="utf-8"))
        self.assertEqual(stored, {"requestedAt": body["requestedAt"]})

        again = self.client.post("/api/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.10"})
        self.assertEqual(again.status_code, 429)

        other = self.client.post("/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.11"})
        self.assertEqual(other.status_code, 200)

    def test_refresh_pending_until_snapshot_is_newer(self) -> None:
        headers = {"Authorization": "Bearer chat-secret-value"}
        old = dict(SAMPLE)
        old["updatedAt"] = "2020-01-01T00:00:00Z"
        self.client.post("/api/robinhood", json=old, headers=headers)
        asked = self.client.post("/api/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.12"})
        requested_at = asked.json()["requestedAt"]

        got = self.client.get("/api/robinhood")
        body = got.json()
        self.assertEqual(got.headers.get("cache-control"), "no-store")
        self.assertTrue(body["refreshPending"])
        self.assertEqual(body["refreshRequestedAt"], requested_at)
        self.assertEqual(body["snapshot"]["updatedAt"], "2020-01-01T00:00:00Z")

        pending = self.client.get("/api/robinhood/pending-refresh")
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(
            pending.json(),
            {"refreshPending": True, "refreshRequestedAt": requested_at},
        )
        alias = self.client.get("/robinhood/pending-refresh")
        self.assertEqual(alias.json()["refreshPending"], True)

    def test_pending_flag_is_false_when_snapshot_is_already_newer(self) -> None:
        headers = {"Authorization": "Bearer chat-secret-value"}
        future = dict(SAMPLE)
        future["updatedAt"] = "2099-01-01T00:00:00Z"
        self.client.post("/api/robinhood", json=future, headers=headers)
        self.client.post("/api/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.13"})
        body = self.client.get("/api/robinhood").json()
        self.assertFalse(body["refreshPending"])
        self.assertNotIn("refreshRequestedAt", body)
        self.assertTrue(refresh_file().is_file())
        self.assertEqual(self.client.get("/api/robinhood/pending-refresh").json(), {"refreshPending": False})

    def test_snapshot_post_clears_pending_refresh(self) -> None:
        self.client.post("/api/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.14"})
        self.assertTrue(refresh_file().is_file())
        denied = self.client.post("/api/robinhood", json=SAMPLE)
        self.assertEqual(denied.status_code, 401)
        self.assertTrue(self.client.get("/api/robinhood").json()["refreshPending"])

        res = self.client.post(
            "/api/robinhood",
            json=SAMPLE,
            headers={"Authorization": "Bearer chat-secret-value"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(refresh_file().exists())
        body = self.client.get("/api/robinhood").json()
        self.assertFalse(body["refreshPending"])
        self.assertNotIn("refreshRequestedAt", body)
        self.assertEqual(self.client.get("/robinhood/pending-refresh").json(), {"refreshPending": False})

    def test_delete_refresh_requires_snapshot_bearer(self) -> None:
        self.client.post("/api/robinhood/refresh", headers={"X-Forwarded-For": "203.0.113.15"})
        denied = self.client.delete("/api/robinhood/refresh")
        self.assertEqual(denied.status_code, 401)
        self.assertTrue(refresh_file().is_file())

        os.environ["ROBINHOOD_BRIDGE_SECRET"] = "rh-secret-value"
        chat = self.client.delete(
            "/api/robinhood/refresh",
            headers={"Authorization": "Bearer chat-secret-value"},
        )
        self.assertEqual(chat.status_code, 401)
        self.assertTrue(refresh_file().is_file())

        ok = self.client.delete(
            "/robinhood/refresh",
            headers={"Authorization": "Bearer rh-secret-value"},
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json(), {"ok": True, "refreshPending": False})
        self.assertFalse(refresh_file().exists())
        self.assertFalse(self.client.get("/api/robinhood").json()["refreshPending"])

    def test_refresh_cors_allows_phone_origin(self) -> None:
        res = self.client.options(
            "/api/robinhood/refresh",
            headers={
                "Origin": "https://simzy420.github.io",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertIn(res.status_code, (200, 204))
        self.assertEqual(res.headers.get("access-control-allow-origin"), "https://simzy420.github.io")
        allow = res.headers.get("access-control-allow-methods", "")
        self.assertIn("POST", allow)
        self.assertIn("DELETE", allow)


if __name__ == "__main__":
    unittest.main()
