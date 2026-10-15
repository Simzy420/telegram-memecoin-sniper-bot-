"""Private Gmail bridge for Dark Command Center.

Talks to imap.gmail.com and smtp.gmail.com as caseylsims@gmail.com using the
GMAIL_APP_PASSWORD environment variable (a Google app password). The process
binds to loopback unless GMAIL_LISTEN_HOST is another private address.

This server is not the public GitHub Pages site and not the public chat Space.
It sends no CORS headers. Requests whose Host, Origin, or Referer is a public
host are rejected. The password is never written to disk and never returned.
"""

from __future__ import annotations

import email
import email.policy
import email.utils
import imaplib
import ipaddress
import json
import os
import re
import smtplib
import sys
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

MAILBOX = "caseylsims@gmail.com"
INBOX_LIMIT = 25
IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
MAX_BODY = 100_000
MAX_SUBJECT = 200
MAX_RECIPIENTS = 10

PUBLIC_HOST_SUFFIXES = (
    "github.io",
    "githubusercontent.com",
    "github.com",
    "hf.space",
    "huggingface.co",
    "vercel.app",
    "netlify.app",
    "pages.dev",
)

CLOSED_MESSAGE = (
    "Gmail is closed. Set GMAIL_APP_PASSWORD on this private mail server "
    "(it listens on 127.0.0.1). Do not put that secret on GitHub Pages, "
    "in a VITE_ variable, or on the public chat Space."
)
PUBLIC_BLOCK_MESSAGE = (
    "Gmail is closed for this public host. The inbox is not loaded and send is disabled."
)

EMAIL_RE = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")
UID_RE = re.compile(br"\bUID (\d+)")
INTERNAL_RE = re.compile(br'INTERNALDATE "([^"]+)"')
FORBIDDEN_FIELDS = {
    "password",
    "apppassword",
    "app_password",
    "gmail_app_password",
    "secret",
}

_HITS: dict[str, list[float]] = {"inbox": [], "read": [], "send": []}


class MailError(Exception):
    """Gmail or the network failed. The message is safe to show."""


class MailInputError(Exception):
    """The browser sent a request the bridge will not accept."""


def current_password() -> str:
    """App passwords are shown in groups of four. Spaces are not part of the secret."""
    raw = os.environ.get("GMAIL_APP_PASSWORD", "")
    return "".join(raw.split())


def normalize_host(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if "://" in text:
        hostname = urlparse(text).hostname or ""
        return hostname.lower().rstrip(".")
    if text.startswith("["):
        end = text.find("]")
        return text[1:end].lower() if end > 1 else ""
    host = text.lower().rstrip(".")
    if host.count(":") == 1:
        host = host.split(":", 1)[0]
    return host


def is_public_mail_host(hostname: str) -> bool:
    host = normalize_host(hostname)
    if not host:
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in PUBLIC_HOST_SUFFIXES)


def is_loopback_or_private(host: str) -> bool:
    name = normalize_host(host)
    if name in {"localhost", "localhost.localdomain"}:
        return True
    if name.endswith(".local") or name.endswith(".internal") or name.endswith(".home.arpa"):
        return True
    try:
        ip = ipaddress.ip_address(name)
    except ValueError:
        return False
    if ip.is_unspecified or ip.is_multicast:
        return False
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        return True
    return bool(ip.is_private or ip.is_loopback or ip.is_link_local)


def listen_host_allowed(host: str) -> bool:
    return is_loopback_or_private(host)


def request_host_allowed(host: str) -> bool:
    name = normalize_host(host)
    if not name or is_public_mail_host(name):
        return False
    if is_loopback_or_private(name):
        return True
    configured = normalize_host(os.environ.get("GMAIL_PRIVATE_HOST", ""))
    return bool(configured) and name == configured and not is_public_mail_host(configured)


def newest_uids(uids: list[bytes], limit: int = INBOX_LIMIT) -> list[bytes]:
    clean = [uid for uid in uids if uid.isdigit()]
    return clean[-limit:]


def to_iso(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    try:
        parsed = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError, OverflowError):
        parsed = None
    if parsed is not None:
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for fmt in ("%d-%b-%Y %H:%M:%S %z", "%d-%b-%Y %H:%M:%S"):
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return ""


def header_text(message: email.message.Message, name: str) -> str:
    value = message.get(name, "")
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()


def html_to_text(html: str) -> str:
    import html as html_lib

    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_body(raw: bytes) -> str:
    message = BytesParser(policy=email.policy.default).parsebytes(raw)
    part = message.get_body(preferencelist=("plain", "html"))
    chosen = part if part is not None else message
    if chosen.get_content_maintype() != "text":
        return ""
    content = chosen.get_content()
    if not isinstance(content, str):
        return ""
    text = html_to_text(content) if chosen.get_content_type() == "text/html" else content.strip()
    if len(text) > MAX_BODY:
        return text[:MAX_BODY]
    return text


def summary_from_headers(uid: str, header_bytes: bytes, internal: str) -> dict[str, str]:
    message = BytesParser(policy=email.policy.default).parsebytes(header_bytes)
    date = to_iso(header_text(message, "Date")) or to_iso(internal)
    return {
        "uid": uid,
        "from": header_text(message, "From"),
        "subject": header_text(message, "Subject"),
        "date": date,
    }


def message_from_raw(uid: str, raw: bytes) -> dict[str, str]:
    message = BytesParser(policy=email.policy.default).parsebytes(raw)
    return {
        "uid": uid,
        "from": header_text(message, "From"),
        "to": header_text(message, "To"),
        "subject": header_text(message, "Subject"),
        "date": to_iso(header_text(message, "Date")),
        "body": extract_body(raw),
    }


def literal_pairs(fetched: list[Any]) -> list[tuple[bytes, bytes]]:
    pairs: list[tuple[bytes, bytes]] = []
    for item in fetched or []:
        if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[0], (bytes, bytearray)):
            meta = bytes(item[0])
            body = item[1] if isinstance(item[1], (bytes, bytearray)) else b""
            pairs.append((meta, bytes(body)))
    return pairs


def summaries_from_fetch(fetched: list[Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for meta, header_bytes in literal_pairs(fetched):
        found = UID_RE.search(meta)
        if not found:
            continue
        uid = found.group(1).decode("ascii")
        if uid in seen:
            continue
        seen.add(uid)
        internal = ""
        internal_found = INTERNAL_RE.search(meta)
        if internal_found:
            internal = internal_found.group(1).decode("ascii", "replace")
        rows.append(summary_from_headers(uid, header_bytes, internal))
    return rows


def order_summaries(rows: list[dict[str, str]], limit: int = INBOX_LIMIT) -> list[dict[str, str]]:
    usable = [row for row in rows if str(row.get("uid", "")).isdigit()]

    def key(row: dict[str, str]) -> tuple[str, int]:
        return (row.get("date") or "", int(row["uid"]))

    return sorted(usable, key=key, reverse=True)[:limit]


def parse_recipients(raw: str) -> list[str]:
    if not isinstance(raw, str) or any(ch in raw for ch in "\r\n"):
        raise MailInputError("Recipient cannot contain line breaks.")
    parts = [part.strip() for part in raw.split(",") if part.strip()]
    if not parts or len(parts) > MAX_RECIPIENTS:
        raise MailInputError("Enter one to ten recipients in To.")
    cleaned: list[str] = []
    for part in parts:
        match = re.search(r"<([^<>]+)>", part)
        address = (match.group(1) if match else part).strip()
        if not EMAIL_RE.match(address):
            raise MailInputError("To must be an email address.")
        cleaned.append(address)
    return cleaned


def clean_subject(raw: str) -> str:
    if not isinstance(raw, str) or any(ch in raw for ch in "\r\n\x00"):
        raise MailInputError("Subject cannot contain line breaks.")
    subject = raw.strip()
    if len(subject) > MAX_SUBJECT:
        raise MailInputError("Subject is too long.")
    return subject


def clean_body(raw: str) -> str:
    if not isinstance(raw, str) or "\x00" in raw:
        raise MailInputError("Body must be text.")
    if len(raw) > MAX_BODY:
        raise MailInputError("Body is too long.")
    return raw


def build_outgoing(to: str, subject: str, body: str) -> tuple[EmailMessage, list[str]]:
    recipients = parse_recipients(to)
    message = EmailMessage()
    message["From"] = MAILBOX
    message["To"] = ", ".join(recipients)
    message["Subject"] = clean_subject(subject)
    message.set_content(clean_body(body))
    return message, recipients


def client_message(exc: BaseException, password: str) -> str:
    text = str(exc)
    if password and len(password) >= 8 and password in text:
        text = text.replace(password, "[redacted]")
    upper = text.upper()
    if "AUTH" in upper or "CREDENTIAL" in upper or "AUTHENTICATIONFAILED" in upper:
        return "Gmail refused the mailbox login. Check GMAIL_APP_PASSWORD on the private mail server."
    sys.stderr.write(f"gmail bridge error: {text}\n")
    return "The private mail server could not reach Gmail."


def fetch_inbox(password: str) -> list[dict[str, str]]:
    try:
        with imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=30) as imap:
            imap.login(MAILBOX, password)
            status, _ = imap.select("INBOX", readonly=True)
            if status != "OK":
                raise MailError("Could not open the inbox.")
            status, data = imap.uid("SEARCH", None, "ALL")
            if status != "OK":
                raise MailError("Could not list the inbox.")
            raw_ids = data[0].split() if data and data[0] else []
            chosen = newest_uids(raw_ids, INBOX_LIMIT)
            if not chosen:
                return []
            status, fetched = imap.uid(
                "FETCH",
                b",".join(chosen),
                "(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])",
            )
            if status != "OK":
                raise MailError("Could not read message headers.")
            return order_summaries(summaries_from_fetch(fetched))
    except MailError:
        raise
    except (imaplib.IMAP4.error, OSError) as exc:
        raise MailError(client_message(exc, password)) from None


def fetch_message(password: str, uid: str) -> dict[str, str] | None:
    if not uid.isdigit() or len(uid) > 20:
        raise MailInputError("Unknown message.")
    try:
        with imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=30) as imap:
            imap.login(MAILBOX, password)
            status, _ = imap.select("INBOX", readonly=True)
            if status != "OK":
                raise MailError("Could not open the inbox.")
            status, fetched = imap.uid("FETCH", uid.encode("ascii"), "(UID BODY.PEEK[])")
            if status != "OK" or not fetched:
                return None
            pairs = literal_pairs(fetched)
            if not pairs or not pairs[0][1]:
                return None
            meta, raw = pairs[0]
            found = UID_RE.search(meta)
            if found and found.group(1).decode("ascii") != uid:
                return None
            return message_from_raw(uid, raw)
    except MailError:
        raise
    except (imaplib.IMAP4.error, OSError) as exc:
        raise MailError(client_message(exc, password)) from None


def deliver(password: str, message: EmailMessage, recipients: list[str]) -> None:
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.login(MAILBOX, password)
            smtp.send_message(message, from_addr=MAILBOX, to_addrs=recipients)
    except (smtplib.SMTPException, OSError) as exc:
        raise MailError(client_message(exc, password)) from None


class Gateway:
    def inbox(self, password: str) -> list[dict[str, str]]:
        return fetch_inbox(password)

    def message(self, password: str, uid: str) -> dict[str, str] | None:
        return fetch_message(password, uid)

    def send(self, password: str, to: str, subject: str, body: str) -> None:
        message, recipients = build_outgoing(to, subject, body)
        deliver(password, message, recipients)


GATEWAY = Gateway()


def reset_limits() -> None:
    for key in _HITS:
        _HITS[key] = []


def limited(action: str, max_n: int, window: float = 60.0) -> bool:
    now = time.monotonic()
    hits = [stamp for stamp in _HITS[action] if now - stamp < window]
    if len(hits) >= max_n:
        _HITS[action] = hits
        return True
    hits.append(now)
    _HITS[action] = hits
    return False


def scrub(payload: dict[str, Any], password: str) -> bytes:
    body = json.dumps(payload)
    if password and len(password) >= 8 and password in body:
        body = body.replace(password, "[redacted]")
    return body.encode("utf-8")


def closed_payload() -> dict[str, Any]:
    return {
        "ok": False,
        "closed": True,
        "mailbox": MAILBOX,
        "limit": INBOX_LIMIT,
        "error": CLOSED_MESSAGE,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        line = fmt % args
        password = current_password()
        if password and len(password) >= 8 and password in line:
            line = line.replace(password, "[redacted]")
        sys.stderr.write(f"{self.address_string()} - {line}\n")

    def _blocked(self) -> bool:
        host = normalize_host(self.headers.get("Host", ""))
        if not request_host_allowed(host):
            self._json(403, {"ok": False, "closed": True, "error": PUBLIC_BLOCK_MESSAGE})
            return True
        for header in ("Origin", "Referer"):
            value = self.headers.get(header, "")
            if not value:
                continue
            if not request_host_allowed(normalize_host(value)):
                self._json(403, {"ok": False, "closed": True, "error": PUBLIC_BLOCK_MESSAGE})
                return True
        return False

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        body = scrub(payload, current_password())
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_raw(self) -> bytes:
        """Consume the body before any response so a closed send cannot desync the connection."""
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as exc:
            self.close_connection = True
            raise MailInputError("Send a JSON object with to, subject, and body.") from exc
        if length < 0 or length > 200_000:
            self.close_connection = True
            raise MailInputError("Request is too large.")
        return self.rfile.read(length) if length else b""

    def _parse_json(self, raw: bytes) -> dict[str, Any]:
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MailInputError("Send a JSON object with to, subject, and body.") from exc
        if not isinstance(data, dict):
            raise MailInputError("Send a JSON object with to, subject, and body.")
        for key in data:
            normalized = str(key).lower().replace("-", "_")
            if normalized in FORBIDDEN_FIELDS:
                raise MailInputError("Do not send the mail secret from the browser.")
        return data

    def _path(self) -> str:
        path = urlparse(self.path).path.rstrip("/")
        return path or "/"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._json(403, {"ok": False, "closed": True, "error": PUBLIC_BLOCK_MESSAGE})

    def do_GET(self) -> None:  # noqa: N802
        if self._blocked():
            return
        path = self._path()
        try:
            if path == "/api/gmail/status":
                self._status()
                return
            if path == "/api/gmail/inbox":
                self._inbox()
                return
            match = re.fullmatch(r"/api/gmail/messages/(\d{1,20})", path)
            if match:
                self._message(match.group(1))
                return
            self._json(404, {"ok": False, "error": "Not found."})
        except MailInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except MailError as exc:
            self._json(502, {"ok": False, "error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        try:
            raw = self._read_raw()
        except MailInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return
        if self._blocked():
            return
        path = self._path()
        try:
            if path != "/api/gmail/send":
                self._json(404, {"ok": False, "error": "Not found."})
                return
            self._send(raw)
        except MailInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except MailError as exc:
            self._json(502, {"ok": False, "error": str(exc)})

    def _require_password(self) -> str | None:
        password = current_password()
        if not password:
            self._json(503, closed_payload())
            return None
        return password

    def _status(self) -> None:
        password = current_password()
        if not password:
            self._json(503, closed_payload())
            return
        self._json(
            200,
            {"ok": True, "closed": False, "mailbox": MAILBOX, "limit": INBOX_LIMIT},
        )

    def _inbox(self) -> None:
        password = self._require_password()
        if password is None:
            return
        if limited("inbox", 30):
            self._json(429, {"ok": False, "error": "Too many inbox reads. Wait a moment."})
            return
        messages = order_summaries(GATEWAY.inbox(password))
        self._json(
            200,
            {"ok": True, "mailbox": MAILBOX, "limit": INBOX_LIMIT, "messages": messages},
        )

    def _message(self, uid: str) -> None:
        password = self._require_password()
        if password is None:
            return
        if limited("read", 60):
            self._json(429, {"ok": False, "error": "Too many message reads. Wait a moment."})
            return
        message = GATEWAY.message(password, uid)
        if message is None:
            self._json(404, {"ok": False, "error": "That message is not in the newest inbox."})
            return
        self._json(200, {"ok": True, "mailbox": MAILBOX, "message": message})

    def _send(self, raw: bytes) -> None:
        password = self._require_password()
        if password is None:
            return
        data = self._parse_json(raw)
        if limited("send", 10):
            self._json(429, {"ok": False, "error": "Too many sends. Wait a moment."})
            return
        to = data.get("to", "")
        subject = data.get("subject", "")
        body = data.get("body", "")
        if not isinstance(to, str) or not isinstance(subject, str) or not isinstance(body, str):
            raise MailInputError("To, subject, and body must be text.")
        # From is locked inside the gateway. A client-supplied from is ignored.
        GATEWAY.send(password, to, subject, body)
        self._json(200, {"ok": True, "sent": True, "from": MAILBOX})


def main() -> None:
    host = os.environ.get("GMAIL_LISTEN_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port_raw = os.environ.get("GMAIL_LISTEN_PORT", "8787").strip() or "8787"
    try:
        port = int(port_raw)
    except ValueError:
        print("GMAIL_LISTEN_PORT must be a number.", file=sys.stderr)
        raise SystemExit(1) from None
    if port < 1 or port > 65535 or not listen_host_allowed(host):
        print("Refusing to listen on a public address. Use 127.0.0.1.", file=sys.stderr)
        raise SystemExit(1)
    httpd = ThreadingHTTPServer((host, port), Handler)
    state = "secret is set" if current_password() else "secret is missing, mail is closed"
    print(
        f"Private Gmail bridge on http://{host}:{port} — {state}. Mailbox {MAILBOX}.",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()


if __name__ == "__main__":
    main()
