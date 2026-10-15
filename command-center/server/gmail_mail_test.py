"""Tests for the private Gmail bridge. No network and no real app password."""

from __future__ import annotations

import http.client
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from email.message import EmailMessage
from pathlib import Path

import gmail_mail as mail


ROOT = Path(__file__).resolve().parents[1]
SENTINEL = "unit-test-secret"


class GatewaySpy(mail.Gateway):
    def __init__(self) -> None:
        self.inbox_calls = 0
        self.sent: list[tuple[str, str, str]] = []
        self.seen_password = ""

    def inbox(self, password: str) -> list[dict[str, str]]:
        self.inbox_calls += 1
        self.seen_password = password
        rows = [
            {"uid": str(index), "from": "A <a@b.co>", "subject": f"n{index}", "date": f"2026-01-{index:02d}T00:00:00Z"}
            for index in range(1, 41)
        ]
        return rows

    def message(self, password: str, uid: str) -> dict[str, str] | None:
        self.seen_password = password
        if uid != "7":
            return None
        return {
            "uid": "7",
            "from": "Ada <ada@example.com>",
            "to": mail.MAILBOX,
            "subject": "Hello",
            "date": "2026-10-01T12:00:00Z",
            "body": "The body text",
        }

    def send(self, password: str, to: str, subject: str, body: str) -> None:
        self.seen_password = password
        self.sent.append((to, subject, body))


class MailServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_password = os.environ.get("GMAIL_APP_PASSWORD")
        self._old_private = os.environ.get("GMAIL_PRIVATE_HOST")
        os.environ.pop("GMAIL_APP_PASSWORD", None)
        os.environ.pop("GMAIL_PRIVATE_HOST", None)
        mail.reset_limits()
        self.spy = GatewaySpy()
        self._old_gateway = mail.GATEWAY
        mail.GATEWAY = self.spy
        self.httpd = mail.ThreadingHTTPServer(("127.0.0.1", 0), mail.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        mail.GATEWAY = self._old_gateway
        if self._old_password is None:
            os.environ.pop("GMAIL_APP_PASSWORD", None)
        else:
            os.environ["GMAIL_APP_PASSWORD"] = self._old_password
        if self._old_private is None:
            os.environ.pop("GMAIL_PRIVATE_HOST", None)
        else:
            os.environ["GMAIL_PRIVATE_HOST"] = self._old_private

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
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                body = response.read()
                return response.status, json.loads(body.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            return exc.code, json.loads(raw)

    def test_closed_without_secret_and_secret_not_in_body(self) -> None:
        os.environ["GMAIL_APP_PASSWORD"] = ""
        status, body = self.request("/api/gmail/inbox")
        self.assertEqual(status, 503)
        self.assertTrue(body["closed"])
        self.assertEqual(self.spy.inbox_calls, 0)
        self.assertNotIn(SENTINEL, json.dumps(body))
        send_status, send_body = self.request(
            "/api/gmail/send",
            "POST",
            {"to": "a@b.co", "subject": "Hi", "body": "Yo"},
        )
        self.assertEqual(send_status, 503)
        self.assertTrue(send_body["closed"])
        self.assertEqual(self.spy.sent, [])

    def test_inbox_is_newest_25_and_open_shows_body(self) -> None:
        os.environ["GMAIL_APP_PASSWORD"] = f"  {SENTINEL}  "
        status, body = self.request("/api/gmail/inbox")
        self.assertEqual(status, 200)
        self.assertEqual(body["mailbox"], mail.MAILBOX)
        self.assertEqual(len(body["messages"]), 25)
        self.assertEqual(body["messages"][0]["uid"], "40")
        self.assertEqual(body["messages"][-1]["uid"], "16")
        self.assertEqual(self.spy.seen_password, SENTINEL)
        self.assertNotIn(SENTINEL, json.dumps(body))
        read_status, message = self.request("/api/gmail/messages/7")
        self.assertEqual(read_status, 200)
        self.assertEqual(message["message"]["body"], "The body text")
        self.assertNotIn(SENTINEL, json.dumps(message))

    def test_send_ignores_from_and_rejects_a_browser_secret(self) -> None:
        os.environ["GMAIL_APP_PASSWORD"] = SENTINEL
        status, body = self.request(
            "/api/gmail/send",
            "POST",
            {"to": "Ada <ada@example.com>", "subject": "Hi", "body": "Yo", "from": "evil@evil.com"},
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["from"], mail.MAILBOX)
        self.assertEqual(self.spy.sent, [("Ada <ada@example.com>", "Hi", "Yo")])
        self.assertNotIn(SENTINEL, json.dumps(body))
        rejected, error = self.request(
            "/api/gmail/send",
            "POST",
            {"to": "a@b.co", "subject": "Hi", "body": "Yo", "password": SENTINEL},
        )
        self.assertEqual(rejected, 400)
        self.assertIn("secret", error["error"].lower())
        self.assertNotIn(SENTINEL, json.dumps(error))

    def test_closed_send_does_not_desync_the_connection(self) -> None:
        os.environ.pop("GMAIL_APP_PASSWORD", None)
        payload = json.dumps({"to": "a@b.co", "subject": "Hi", "body": "Yo"}).encode("utf-8")
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(
            "POST",
            "/api/gmail/send",
            body=payload,
            headers={"Host": "127.0.0.1", "Content-Type": "application/json"},
        )
        first = conn.getresponse()
        first_body = first.read()
        self.assertEqual(first.status, 503)
        self.assertIn(b"closed", first_body)
        conn.request("GET", "/api/gmail/status", headers={"Host": "127.0.0.1"})
        second = conn.getresponse()
        second_body = second.read()
        self.assertEqual(second.status, 503)
        self.assertIn(b"GMAIL_APP_PASSWORD", second_body)
        self.assertNotIn(b"Bad request", second_body)
        conn.close()

    def test_public_origin_cannot_read_or_send(self) -> None:
        os.environ["GMAIL_APP_PASSWORD"] = SENTINEL
        for origin in (
            "https://simzy420.github.io",
            "https://simzy-command-center-chat.hf.space",
        ):
            status, body = self.request("/api/gmail/inbox", origin=origin)
            self.assertEqual(status, 403, origin)
            self.assertTrue(body["closed"])
            send_status, _ = self.request(
                "/api/gmail/send",
                "POST",
                {"to": "a@b.co", "subject": "Hi", "body": "Yo"},
                origin=origin,
            )
            self.assertEqual(send_status, 403, origin)
        self.assertEqual(self.spy.inbox_calls, 0)
        self.assertEqual(self.spy.sent, [])
        pages, _ = self.request("/api/gmail/inbox", host="simzy420.github.io")
        self.assertEqual(pages, 403)

    def test_response_has_no_cors_header(self) -> None:
        os.environ["GMAIL_APP_PASSWORD"] = SENTINEL
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/gmail/status",
            headers={"Host": "127.0.0.1"},
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body["mailbox"], mail.MAILBOX)
        self.assertNotIn("messages", body)


class PureMailTest(unittest.TestCase):
    def test_listen_host_rejects_public_addresses(self) -> None:
        self.assertTrue(mail.listen_host_allowed("127.0.0.1"))
        self.assertTrue(mail.listen_host_allowed("localhost"))
        self.assertTrue(mail.listen_host_allowed("192.168.1.9"))
        self.assertTrue(mail.listen_host_allowed("10.1.1.1"))
        self.assertFalse(mail.listen_host_allowed("0.0.0.0"))
        self.assertFalse(mail.listen_host_allowed("8.8.8.8"))
        self.assertFalse(mail.listen_host_allowed("simzy420.github.io"))

    def test_newest_25_and_header_parse(self) -> None:
        uids = [str(index).encode() for index in range(1, 41)]
        chosen = mail.newest_uids(uids)
        self.assertEqual(len(chosen), 25)
        self.assertEqual(chosen[0], b"16")
        self.assertEqual(chosen[-1], b"40")
        header = b"From: Ada Lovelace <ada@example.com>\r\nSubject: =?utf-8?q?Caf=C3=A9?=\r\nDate: Thu, 01 Oct 2026 12:00:00 +0000\r\n\r\n"
        fetched = [
            (
                b'1 (UID 40 INTERNALDATE "01-Oct-2026 12:00:00 +0000" BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {20}',
                header,
            ),
            b")",
        ]
        rows = mail.summaries_from_fetch(fetched)
        self.assertEqual(rows[0]["uid"], "40")
        self.assertIn("Ada", rows[0]["from"])
        self.assertEqual(rows[0]["subject"], "Café")
        self.assertEqual(rows[0]["date"], "2026-10-01T12:00:00Z")

    def test_body_prefers_plain_and_strips_html(self) -> None:
        raw = (
            b"From: Ada <ada@example.com>\r\n"
            b"To: caseylsims@gmail.com\r\n"
            b"Subject: Hi\r\n"
            b"MIME-Version: 1.0\r\n"
            b'Content-Type: multipart/alternative; boundary="b"\r\n'
            b"\r\n"
            b"--b\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n"
            b"\r\n"
            b"Plain body\r\n"
            b"--b\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"\r\n"
            b"<p>HTML <script>alert(1)</script>body</p>\r\n"
            b"--b--\r\n"
        )
        self.assertEqual(mail.extract_body(raw), "Plain body")
        html_only = (
            b"From: Ada <ada@example.com>\r\n"
            b"Subject: Hi\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"\r\n"
            b"<p>Hello<br>there</p><script>steal()</script>\r\n"
        )
        text = mail.extract_body(html_only)
        self.assertIn("Hello", text)
        self.assertIn("there", text)
        self.assertNotIn("script", text.lower())
        self.assertNotIn("steal", text)

    def test_outgoing_mail_is_locked_to_the_mailbox(self) -> None:
        message, recipients = mail.build_outgoing("Ada <ada@example.com>", "Hello", "Body")
        self.assertIsInstance(message, EmailMessage)
        self.assertEqual(message["From"], mail.MAILBOX)
        self.assertEqual(recipients, ["ada@example.com"])
        self.assertEqual(message["Subject"], "Hello")
        with self.assertRaises(mail.MailInputError):
            mail.build_outgoing("ada@example.com\r\nBcc: evil@evil.com", "Hi", "Body")
        with self.assertRaises(mail.MailInputError):
            mail.build_outgoing("ada@example.com", "Hi\nthere", "Body")

    def test_imap_and_smtp_use_the_locked_mailbox(self) -> None:
        header = b"From: Ada <ada@example.com>\r\nSubject: Hi\r\nDate: Thu, 01 Oct 2026 12:00:00 +0000\r\n\r\n"

        class FakeIMAP:
            def __init__(self, host: str, port: int, timeout: int | None = None) -> None:
                self.host = host
                self.port = port

            def login(self, user: str, password: str) -> tuple[str, list[bytes]]:
                FakeIMAP.user = user
                FakeIMAP.password = password
                return ("OK", [b"logged"])

            def select(self, mailbox: str, readonly: bool = False) -> tuple[str, list[bytes]]:
                FakeIMAP.readonly = readonly
                self.assert_mailbox = mailbox
                return ("OK", [b"1"])

            def uid(self, command: str, *args: object) -> tuple[str, list]:
                if command == "SEARCH":
                    return ("OK", [b"1 2 3"])
                return (
                    "OK",
                    [
                        (
                            b'1 (UID 3 INTERNALDATE "01-Oct-2026 12:00:00 +0000" BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {10}',
                            header,
                        )
                    ],
                )

            def __enter__(self) -> FakeIMAP:
                return self

            def __exit__(self, *args: object) -> bool:
                return False

        original_imap = mail.imaplib.IMAP4_SSL
        original_smtp = mail.smtplib.SMTP_SSL
        try:
            mail.imaplib.IMAP4_SSL = FakeIMAP  # type: ignore[misc, assignment]
            rows = mail.fetch_inbox(SENTINEL)
            self.assertEqual(FakeIMAP.user, mail.MAILBOX)
            self.assertEqual(FakeIMAP.password, SENTINEL)
            self.assertTrue(FakeIMAP.readonly)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["uid"], "3")

            class FakeSMTP:
                def __init__(self, host: str, port: int, timeout: int | None = None) -> None:
                    FakeSMTP.host = host
                    FakeSMTP.port = port

                def login(self, user: str, password: str) -> None:
                    FakeSMTP.user = user
                    FakeSMTP.password = password

                def send_message(self, message: EmailMessage, from_addr: str | None = None, to_addrs: list[str] | None = None) -> None:
                    FakeSMTP.from_addr = from_addr
                    FakeSMTP.to_addrs = to_addrs
                    FakeSMTP.message = message

                def __enter__(self) -> FakeSMTP:
                    return self

                def __exit__(self, *args: object) -> bool:
                    return False

            mail.smtplib.SMTP_SSL = FakeSMTP  # type: ignore[misc, assignment]
            message, recipients = mail.build_outgoing("ada@example.com", "Hi", "Yo")
            mail.deliver(SENTINEL, message, recipients)
            self.assertEqual(FakeSMTP.user, mail.MAILBOX)
            self.assertEqual(FakeSMTP.from_addr, mail.MAILBOX)
            self.assertEqual(FakeSMTP.to_addrs, ["ada@example.com"])
            self.assertEqual(FakeSMTP.host, mail.SMTP_HOST)
        finally:
            mail.imaplib.IMAP4_SSL = original_imap
            mail.smtplib.SMTP_SSL = original_smtp

    def test_password_in_an_auth_error_is_not_returned(self) -> None:
        message = mail.client_message(Exception(f"AUTHENTICATIONFAILED {SENTINEL}"), SENTINEL)
        self.assertNotIn(SENTINEL, message)

    def test_space_and_pages_sources_do_not_grow_a_mail_route(self) -> None:
        space = (ROOT / "spaces" / "command-center-chat" / "main.py").read_text(encoding="utf-8")
        self.assertNotIn("/api/gmail", space)
        self.assertNotIn("GMAIL_APP_PASSWORD", space)
        api_dir = ROOT / "api"
        self.assertFalse(any("gmail" in path.name.lower() for path in api_dir.iterdir()))


if __name__ == "__main__":
    unittest.main()
