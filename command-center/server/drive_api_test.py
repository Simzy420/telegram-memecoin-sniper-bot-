"""Tests for the private Google Drive bridge. No network and no real OAuth secret."""

from __future__ import annotations

import http.client
import json
import os
import threading
import unittest
import urllib.error
import urllib.request

import drive_api as drive


SENTINEL = "unit-test-drive-secret-value"
PASSWORD = "unit-test-drive-password"
FILE_ID = "abcdefghij"


def set_secrets(value: str | None) -> None:
    names = ("GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN")
    if value is None:
        for name in names:
            os.environ.pop(name, None)
        return
    for name in names:
        os.environ[name] = value


class GatewaySpy(drive.Gateway):
    def __init__(self) -> None:
        self.listed = 0
        self.reads: list[str] = []
        self.created: list[tuple[str, str]] = []
        self.updated: list[tuple[str, str]] = []
        self.fail_with = ""

    def list_files(self) -> list[dict]:
        self.listed += 1
        if self.fail_with:
            raise drive.DriveError(self.fail_with)
        return [
            {
                "id": f"fileid{index:04d}",
                "name": f"n{index}",
                "mimeType": "text/plain",
                "modifiedTime": f"2026-01-{index:02d}T00:00:00Z" if index < 32 else "",
                "writable": True,
            }
            for index in range(1, 31)
        ]

    def read_file(self, file_id: str) -> dict:
        self.reads.append(file_id)
        return {
            "id": file_id,
            "name": "notes.txt",
            "mimeType": "text/plain",
            "modifiedTime": "2026-10-01T00:00:00Z",
            "content": "hello from drive",
            "writable": True,
        }

    def create_file(self, name: str, content: str) -> dict:
        self.created.append((name, content))
        return {"id": FILE_ID, "name": name, "mimeType": "text/plain", "content": content, "writable": True}

    def update_file(self, file_id: str, content: str) -> dict:
        self.updated.append((file_id, content))
        return {"id": file_id, "name": "notes.txt", "mimeType": "text/plain", "content": content, "writable": True}


class DriveServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = {name: os.environ.get(name) for name in (
            "GOOGLE_DRIVE_CLIENT_ID",
            "GOOGLE_DRIVE_CLIENT_SECRET",
            "GOOGLE_DRIVE_REFRESH_TOKEN",
            "COMMAND_CENTER_PASSWORD",
            "DRIVE_PRIVATE_HOST",
        )}
        set_secrets(None)
        os.environ.pop("COMMAND_CENTER_PASSWORD", None)
        os.environ.pop("DRIVE_PRIVATE_HOST", None)
        self.cookie = ""
        drive.reset_limits()
        self.spy = GatewaySpy()
        self._old_gateway = drive.GATEWAY
        drive.GATEWAY = self.spy
        self.httpd = drive.ThreadingHTTPServer(("127.0.0.1", 0), drive.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        drive.GATEWAY = self._old_gateway
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def request(
        self,
        path: str,
        method: str = "GET",
        payload: dict | None = None,
        host: str = "127.0.0.1",
        origin: str | None = None,
    ) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Host": host, "Accept": "application/json"}
        if origin:
            headers["Origin"] = origin
        if self.cookie:
            headers["Cookie"] = self.cookie
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def unlock(self) -> None:
        os.environ["COMMAND_CENTER_PASSWORD"] = PASSWORD
        data = json.dumps({"password": PASSWORD}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/drive/session",
            data=data,
            headers={"Host": "127.0.0.1", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            cookie = response.headers.get("Set-Cookie") or ""
            body = json.loads(response.read().decode("utf-8"))
        self.assertTrue(body["ok"])
        self.assertNotIn(PASSWORD, json.dumps(body))
        self.cookie = cookie.split(";", 1)[0]

    def test_closed_without_secret_does_not_call_drive(self) -> None:
        status, body = self.request("/api/drive/files")
        self.assertEqual(status, 503)
        self.assertTrue(body["needsPassword"])
        self.assertIn("COMMAND_CENTER_PASSWORD", body["error"])
        self.assertNotIn("files", body)
        self.assertEqual(self.spy.listed, 0)
        write_status, write_body = self.request("/api/drive/files", "POST", {"name": "a.txt", "content": "hi"})
        self.assertEqual(write_status, 503)
        self.assertTrue(write_body["needsPassword"])
        self.assertNotIn("files", write_body)
        self.assertEqual(self.spy.created, [])

    def test_closed_post_does_not_desync_the_connection(self) -> None:
        payload = json.dumps({"name": "a.txt", "content": "hi"}).encode("utf-8")
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(
            "POST",
            "/api/drive/files",
            body=payload,
            headers={"Host": "127.0.0.1", "Content-Type": "application/json"},
        )
        first = conn.getresponse()
        first_body = first.read()
        self.assertEqual(first.status, 503)
        self.assertIn(b"needsPassword", first_body)
        self.assertNotIn(b"files", first_body)
        conn.request("GET", "/api/drive/status", headers={"Host": "127.0.0.1"})
        second = conn.getresponse()
        second_body = second.read()
        self.assertEqual(second.status, 503)
        self.assertIn(b"COMMAND_CENTER_PASSWORD", second_body)
        self.assertNotIn(b"Bad request", second_body)
        conn.close()

    def test_wrong_password_returns_no_files(self) -> None:
        os.environ["COMMAND_CENTER_PASSWORD"] = PASSWORD
        set_secrets(SENTINEL)
        status, body = self.request("/api/drive/files")
        self.assertEqual(status, 401)
        self.assertTrue(body["needsPassword"])
        self.assertNotIn("files", body)
        self.assertEqual(self.spy.listed, 0)
        wrong, error = self.request("/api/drive/session", "POST", {"password": "nope"})
        self.assertEqual(wrong, 401)
        self.assertEqual(error["error"], "Wrong password.")
        self.assertNotIn("files", error)
        self.assertNotIn(PASSWORD, json.dumps(error))
        self.assertNotIn(SENTINEL, json.dumps(error))

    def test_list_is_capped_and_open_shows_contents(self) -> None:
        set_secrets(SENTINEL)
        self.unlock()
        status, body = self.request("/api/drive/files")
        self.assertEqual(status, 200)
        self.assertEqual(body["account"], drive.ACCOUNT)
        self.assertEqual(len(body["files"]), 25)
        self.assertEqual(self.spy.listed, 1)
        self.assertNotIn(SENTINEL, json.dumps(body))
        read_status, opened = self.request(f"/api/drive/files/{FILE_ID}")
        self.assertEqual(read_status, 200)
        self.assertEqual(opened["file"]["content"], "hello from drive")
        self.assertEqual(self.spy.reads, [FILE_ID])
        self.assertNotIn(SENTINEL, json.dumps(opened))

    def test_create_and_update_and_reject_a_browser_secret(self) -> None:
        set_secrets(SENTINEL)
        self.unlock()
        status, body = self.request("/api/drive/files", "POST", {"name": "notes.txt", "content": "hello"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["account"], drive.ACCOUNT)
        self.assertEqual(self.spy.created, [("notes.txt", "hello")])
        self.assertNotIn(SENTINEL, json.dumps(body))
        updated, saved = self.request(f"/api/drive/files/{FILE_ID}", "PUT", {"content": "edited"})
        self.assertEqual(updated, 200, saved)
        self.assertEqual(self.spy.updated, [(FILE_ID, "edited")])
        rejected, error = self.request(
            "/api/drive/files",
            "POST",
            {"name": "x.txt", "content": "no", "client_secret": SENTINEL},
        )
        self.assertEqual(rejected, 400)
        self.assertIn("secret", error["error"].lower())
        self.assertNotIn(SENTINEL, json.dumps(error))

    def test_secret_in_an_error_is_scrubbed(self) -> None:
        set_secrets(SENTINEL)
        self.unlock()
        self.spy.fail_with = f"token {SENTINEL} leaked"
        status, body = self.request("/api/drive/files")
        self.assertEqual(status, 502)
        self.assertNotIn(SENTINEL, json.dumps(body))
        self.assertIn("[redacted]", body["error"])

    def test_public_origin_cannot_list_or_save(self) -> None:
        set_secrets(SENTINEL)
        for origin in (
            "https://simzy420.github.io",
            "https://simzy-command-center-chat.hf.space",
            "https://command-center.vercel.app",
        ):
            status, body = self.request("/api/drive/files", origin=origin)
            self.assertEqual(status, 403, origin)
            self.assertTrue(body["closed"])
            write_status, _ = self.request(
                "/api/drive/files",
                "POST",
                {"name": "a.txt", "content": "hi"},
                origin=origin,
            )
            self.assertEqual(write_status, 403, origin)
        self.assertEqual(self.spy.listed, 0)
        self.assertEqual(self.spy.created, [])
        pages, _ = self.request("/api/drive/files", host="simzy420.github.io")
        self.assertEqual(pages, 403)

    def test_bad_file_id_is_rejected(self) -> None:
        set_secrets(SENTINEL)
        self.unlock()
        status, body = self.request("/api/drive/files/short")
        self.assertEqual(status, 404)
        self.assertEqual(self.spy.reads, [])
        self.assertNotIn("content", body)

    def test_unlocked_without_google_secret_lists_nothing(self) -> None:
        self.unlock()
        set_secrets(None)
        status, body = self.request("/api/drive/files")
        self.assertEqual(status, 503)
        self.assertIn("GOOGLE_DRIVE_CLIENT_ID", body["error"])
        self.assertNotIn("files", body)
        self.assertEqual(self.spy.listed, 0)

    def test_response_has_no_cors_header(self) -> None:
        set_secrets(SENTINEL)
        self.unlock()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/drive/status",
            headers={"Host": "127.0.0.1", "Cookie": self.cookie},
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["account"], drive.ACCOUNT)
        self.assertFalse(body["closed"])
        self.assertNotIn("files", body)
        options = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        options.request("OPTIONS", "/api/drive/files", headers={"Host": "127.0.0.1", "Origin": "https://evil.example"})
        denied = options.getresponse()
        raw = denied.read()
        self.assertEqual(denied.status, 403)
        self.assertIsNone(denied.getheader("Access-Control-Allow-Origin"))
        self.assertIn(b"closed", raw)
        options.close()


class DriveClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = {name: os.environ.get(name) for name in (
            "GOOGLE_DRIVE_CLIENT_ID",
            "GOOGLE_DRIVE_CLIENT_SECRET",
            "GOOGLE_DRIVE_REFRESH_TOKEN",
        )}

    def tearDown(self) -> None:
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_wrong_account_returns_no_files(self) -> None:
        set_secrets(SENTINEL)
        calls: list[str] = []

        def transport(method: str, url: str, headers: dict, body: bytes | None) -> tuple[int, bytes]:
            calls.append(url)
            if "oauth2.googleapis.com" in url:
                return 200, b'{"access_token":"ya29.test"}'
            if url.endswith("about?fields=user(emailAddress)"):
                return 200, b'{"user":{"emailAddress":"someoneelse@gmail.com"}}'
            return 500, b'{"error":"should not list"}'

        client = drive.DriveClient(transport)
        with self.assertRaises(drive.DriveError) as caught:
            client.list_files()
        self.assertIn(drive.ACCOUNT, str(caught.exception))
        self.assertTrue(all("drive/v3/files" not in url for url in calls))

    def test_google_doc_update_is_refused(self) -> None:
        set_secrets(SENTINEL)

        def transport(method: str, url: str, headers: dict, body: bytes | None) -> tuple[int, bytes]:
            if "oauth2.googleapis.com" in url:
                return 200, b'{"access_token":"ya29.test"}'
            if "about?fields=" in url:
                return 200, json.dumps({"user": {"emailAddress": drive.ACCOUNT}}).encode()
            if method == "GET":
                return 200, json.dumps(
                    {"id": FILE_ID, "name": "Plan", "mimeType": "application/vnd.google-apps.document"}
                ).encode()
            raise AssertionError(method + " " + url)

        client = drive.DriveClient(transport)
        with self.assertRaises(drive.DriveInputError) as caught:
            client.update_file(FILE_ID, "new text")
        self.assertIn("new text file", str(caught.exception))

    def test_listen_host_rejects_public_addresses(self) -> None:
        self.assertTrue(drive.listen_host_allowed("127.0.0.1"))
        self.assertTrue(drive.listen_host_allowed("localhost"))
        self.assertTrue(drive.listen_host_allowed("192.168.1.9"))
        self.assertFalse(drive.listen_host_allowed("0.0.0.0"))
        self.assertFalse(drive.listen_host_allowed("8.8.8.8"))
        self.assertFalse(drive.listen_host_allowed("simzy420.github.io"))


if __name__ == "__main__":
    unittest.main()
