"""Private Google Drive bridge for Dark Command Center.

Lists, opens, creates, and updates files in caseylsims@gmail.com through the
Google Drive API v3. OAuth client id, client secret, and refresh token come
from the environment of this process only. The process binds to loopback.
It sends no CORS headers and rejects public hosts.

This is not the on-device Files widget, and it is not the public chat Space.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import urlparse

ACCOUNT = "caseylsims@gmail.com"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
LIST_LIMIT = 25
MAX_CONTENT = 100_000
AUTH_REDIRECT = "http://127.0.0.1:8799/"
FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,200}$")
TEXT_MIME = {
    "application/json",
    "application/javascript",
    "application/csv",
    "text/csv",
    "application/xml",
    "text/xml",
}
EXPORT_MIME = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}
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
    "Google Drive is closed. On this private server set GOOGLE_DRIVE_CLIENT_ID, "
    "GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN for "
    f"{ACCOUNT}. Enable the Google Drive API and consent with scope {DRIVE_SCOPE}. "
    "Do not put those values in a VITE_ variable, GitHub Pages, Vercel, or the chat Space."
)
PUBLIC_BLOCK_MESSAGE = (
    "Google Drive is closed for this public host. Files are not loaded and send is disabled."
)
FORBIDDEN_FIELDS = {
    "password",
    "secret",
    "client_secret",
    "client_id",
    "refresh_token",
    "access_token",
    "google_drive_client_secret",
    "google_drive_refresh_token",
    "google_drive_client_id",
}

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]
_HITS: dict[str, list[float]] = {"list": [], "read": [], "write": [], "auth": []}
COOKIE_NAME = "cc_drive_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7
PASSWORD_UNSET_MESSAGE = (
    "Set COMMAND_CENTER_PASSWORD on the server. The Google Drive section stays empty until "
    "that variable is set. Do not put it in a VITE_ variable or in the app."
)
GOOGLE_UNSET_MESSAGE = (
    "Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN "
    "on the server. The password was accepted. Drive files stay empty until those variables are set."
)


class DriveError(Exception):
    """Google Drive or the network failed. The message is safe to show."""


class DriveInputError(Exception):
    """The browser sent a request the bridge will not accept."""


def env_value(name: str) -> str:
    return os.environ.get(name, "").strip()


def current_secrets() -> dict[str, str] | None:
    client_id = env_value("GOOGLE_DRIVE_CLIENT_ID")
    client_secret = env_value("GOOGLE_DRIVE_CLIENT_SECRET")
    refresh_token = env_value("GOOGLE_DRIVE_REFRESH_TOKEN")
    if not client_id or not client_secret or not refresh_token:
        return None
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }


def secret_values() -> list[str]:
    values = [
        env_value("COMMAND_CENTER_PASSWORD"),
        env_value("GOOGLE_DRIVE_CLIENT_ID"),
        env_value("GOOGLE_DRIVE_CLIENT_SECRET"),
        env_value("GOOGLE_DRIVE_REFRESH_TOKEN"),
    ]
    return [value for value in values if len(value) >= 8]


def password_configured() -> bool:
    return bool(env_value("COMMAND_CENTER_PASSWORD"))


def passwords_match(given: object) -> bool:
    expected = env_value("COMMAND_CENTER_PASSWORD")
    if not expected or not isinstance(given, str) or not given:
        return False
    return hmac.compare_digest(
        hashlib.sha256(given.encode("utf-8")).digest(),
        hashlib.sha256(expected.encode("utf-8")).digest(),
    )


def issue_token() -> str:
    exp = str(int(time.time()) + COOKIE_MAX_AGE)
    sig = hmac.new(env_value("COMMAND_CENTER_PASSWORD").encode("utf-8"), exp.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def token_ok(token: str) -> bool:
    secret = env_value("COMMAND_CENTER_PASSWORD")
    if not secret or not token or "." not in token:
        return False
    exp, sig = token.split(".", 1)
    if not exp.isdigit() or int(exp) < int(time.time()):
        return False
    expected = hmac.new(secret.encode("utf-8"), exp.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def read_cookie(header: str) -> str:
    for part in (header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE_NAME:
            return value
    return ""


def scrub_text(text: str, extra: list[str] | None = None) -> str:
    cleaned = text
    for value in secret_values() + [item for item in (extra or []) if len(item) >= 8]:
        cleaned = cleaned.replace(value, "[redacted]")
    return cleaned


def normalize_host(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if "://" in text:
        return (urlparse(text).hostname or "").lower().rstrip(".")
    if text.startswith("["):
        end = text.find("]")
        return text[1:end].lower() if end > 1 else ""
    host = text.lower().rstrip(".")
    if host.count(":") == 1:
        host = host.split(":", 1)[0]
    return host


def is_public_host(hostname: str) -> bool:
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
    if not name or is_public_host(name):
        return False
    if is_loopback_or_private(name):
        return True
    configured = normalize_host(os.environ.get("DRIVE_PRIVATE_HOST", ""))
    return bool(configured) and name == configured and not is_public_host(configured)


def file_is_writable(mime: str) -> bool:
    lowered = (mime or "").lower()
    return lowered.startswith("text/") or lowered in TEXT_MIME


def consent_url(client_id: str) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": AUTH_REDIRECT,
            "response_type": "code",
            "scope": DRIVE_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "login_hint": ACCOUNT,
        }
    )
    return "https://accounts.google.com/o/oauth2/v2/auth?" + query


def urllib_transport(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        return exc.code, payload


class DriveClient:
    def __init__(self, transport: Transport | None = None) -> None:
        self.transport = transport or urllib_transport
        self._access = ""

    def _request(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        auth: bool = True,
    ) -> tuple[int, bytes]:
        sent = dict(headers or {})
        if auth:
            token = self.access_token()
            sent["Authorization"] = f"Bearer {token}"
        status, payload = self.transport(method, url, sent, body)
        if status >= 400:
            scrub_text(payload.decode("utf-8", "replace")[:500], [self._access])
            if status in {401, 403}:
                raise DriveError("Google refused the Drive login. Check the OAuth refresh token on the private server.")
            raise DriveError("The private Drive server could not complete that request.")
        return status, payload

    def access_token(self) -> str:
        if self._access:
            return self._access
        secrets = current_secrets()
        if secrets is None:
            raise DriveError(CLOSED_MESSAGE)
        form = urllib.parse.urlencode(
            {
                "client_id": secrets["client_id"],
                "client_secret": secrets["client_secret"],
                "refresh_token": secrets["refresh_token"],
                "grant_type": "refresh_token",
            }
        ).encode("utf-8")
        status, payload = self.transport(
            "POST",
            "https://oauth2.googleapis.com/token",
            {"Content-Type": "application/x-www-form-urlencoded"},
            form,
        )
        try:
            data = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DriveError("Google did not return a Drive access token.") from exc
        token = data.get("access_token") if isinstance(data, dict) else ""
        if status >= 400 or not isinstance(token, str) or not token:
            raise DriveError("Google refused the Drive login. Check the OAuth refresh token on the private server.")
        self._access = token
        return token

    def assert_account(self) -> None:
        _status, payload = self._request(
            "GET",
            "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
        )
        data = json.loads(payload.decode("utf-8"))
        email = ""
        if isinstance(data, dict):
            user = data.get("user")
            if isinstance(user, dict) and isinstance(user.get("emailAddress"), str):
                email = user["emailAddress"]
        if email.lower() != ACCOUNT:
            raise DriveError(f"This Drive bridge only opens {ACCOUNT}.")

    def list_files(self) -> list[dict[str, Any]]:
        self.assert_account()
        query = urllib.parse.urlencode(
            {
                "pageSize": str(LIST_LIMIT),
                "orderBy": "modifiedTime desc",
                "q": "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
                "fields": "files(id,name,mimeType,modifiedTime)",
                "spaces": "drive",
            }
        )
        _status, payload = self._request("GET", "https://www.googleapis.com/drive/v3/files?" + query)
        data = json.loads(payload.decode("utf-8"))
        rows = data.get("files") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            return []
        files: list[dict[str, Any]] = []
        for row in rows[:LIST_LIMIT]:
            if not isinstance(row, dict):
                continue
            file_id = str(row.get("id") or "")
            if not FILE_ID_RE.match(file_id):
                continue
            mime = str(row.get("mimeType") or "")
            files.append(
                {
                    "id": file_id,
                    "name": str(row.get("name") or "Untitled"),
                    "mimeType": mime,
                    "modifiedTime": str(row.get("modifiedTime") or ""),
                    "writable": file_is_writable(mime),
                }
            )
        return files

    def read_file(self, file_id: str) -> dict[str, Any]:
        if not FILE_ID_RE.match(file_id):
            raise DriveInputError("Unknown Drive file.")
        self.assert_account()
        meta = self._metadata(file_id)
        mime = str(meta.get("mimeType") or "")
        export = EXPORT_MIME.get(mime)
        if export:
            url = (
                f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(file_id)}/export?"
                + urllib.parse.urlencode({"mimeType": export})
            )
        elif mime == "application/vnd.google-apps.folder":
            raise DriveInputError("That Drive item is a folder.")
        elif file_is_writable(mime) or mime.startswith("text/") or not mime:
            url = f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(file_id)}?alt=media"
        else:
            raise DriveInputError("This Drive file is not text, so its contents are not shown here.")
        _status, payload = self._request("GET", url)
        if b"\x00" in payload[:1024]:
            raise DriveInputError("This Drive file is not text, so its contents are not shown here.")
        text = payload.decode("utf-8", "replace")
        if len(text) > MAX_CONTENT:
            text = text[:MAX_CONTENT]
        return {
            "id": file_id,
            "name": str(meta.get("name") or "Untitled"),
            "mimeType": mime,
            "modifiedTime": str(meta.get("modifiedTime") or ""),
            "content": text,
            "writable": file_is_writable(mime),
        }

    def create_file(self, name: str, content: str) -> dict[str, Any]:
        cleaned = clean_name(name)
        body = clean_content(content)
        self.assert_account()
        meta_body = json.dumps({"name": cleaned, "mimeType": "text/plain"}).encode("utf-8")
        _status, payload = self._request(
            "POST",
            "https://www.googleapis.com/drive/v3/files",
            {"Content-Type": "application/json"},
            meta_body,
        )
        created = json.loads(payload.decode("utf-8"))
        file_id = str(created.get("id") or "") if isinstance(created, dict) else ""
        if not FILE_ID_RE.match(file_id):
            raise DriveError("Google Drive did not return a file id.")
        self._upload(file_id, body)
        return {"id": file_id, "name": cleaned, "mimeType": "text/plain", "content": body, "writable": True}

    def update_file(self, file_id: str, content: str) -> dict[str, Any]:
        if not FILE_ID_RE.match(file_id):
            raise DriveInputError("Unknown Drive file.")
        body = clean_content(content)
        self.assert_account()
        meta = self._metadata(file_id)
        mime = str(meta.get("mimeType") or "")
        if not file_is_writable(mime):
            raise DriveInputError(
                "This Google file is shown as text, but Save cannot overwrite it. Save a new text file instead."
            )
        self._upload(file_id, body)
        return {
            "id": file_id,
            "name": str(meta.get("name") or "Untitled"),
            "mimeType": mime,
            "content": body,
            "writable": True,
        }

    def _metadata(self, file_id: str) -> dict[str, Any]:
        _status, payload = self._request(
            "GET",
            "https://www.googleapis.com/drive/v3/files/"
            + urllib.parse.quote(file_id)
            + "?fields=id,name,mimeType,modifiedTime",
        )
        data = json.loads(payload.decode("utf-8"))
        if not isinstance(data, dict):
            raise DriveError("Google Drive did not return that file.")
        return data

    def _upload(self, file_id: str, content: str) -> None:
        self._request(
            "PATCH",
            "https://www.googleapis.com/upload/drive/v3/files/"
            + urllib.parse.quote(file_id)
            + "?uploadType=media",
            {"Content-Type": "text/plain; charset=utf-8"},
            content.encode("utf-8"),
        )


def clean_name(name: str) -> str:
    if not isinstance(name, str):
        raise DriveInputError("Name the file first.")
    cleaned = name.strip()
    if not cleaned or len(cleaned) > 200 or any(ch in cleaned for ch in "\r\n\x00/\\"):
        raise DriveInputError("Use a plain file name.")
    return cleaned


def clean_content(content: str) -> str:
    if not isinstance(content, str) or "\x00" in content:
        raise DriveInputError("File contents must be text.")
    if len(content) > MAX_CONTENT:
        raise DriveInputError("This file is too long to write to Drive.")
    return content


def exchange_code(client_id: str, client_secret: str, code: str, transport: Transport | None = None) -> str:
    call = transport or urllib_transport
    form = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": AUTH_REDIRECT,
        }
    ).encode("utf-8")
    status, payload = call(
        "POST",
        "https://oauth2.googleapis.com/token",
        {"Content-Type": "application/x-www-form-urlencoded"},
        form,
    )
    data = json.loads(payload.decode("utf-8"))
    token = data.get("refresh_token") if isinstance(data, dict) else ""
    if status >= 400 or not isinstance(token, str) or not token:
        raise DriveError("Google did not return a refresh token. Consent again with prompt=consent.")
    return token


class Gateway:
    def __init__(self, client: DriveClient | None = None) -> None:
        self.client = client or DriveClient()

    def list_files(self) -> list[dict[str, Any]]:
        return self.client.list_files()

    def read_file(self, file_id: str) -> dict[str, Any]:
        return self.client.read_file(file_id)

    def create_file(self, name: str, content: str) -> dict[str, Any]:
        return self.client.create_file(name, content)

    def update_file(self, file_id: str, content: str) -> dict[str, Any]:
        return self.client.update_file(file_id, content)


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


def closed_payload() -> dict[str, Any]:
    return {"ok": False, "closed": True, "account": ACCOUNT, "error": CLOSED_MESSAGE}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        line = scrub_text(fmt % args)
        sys.stderr.write(f"{self.address_string()} - {line}\n")

    def _blocked(self) -> bool:
        host = normalize_host(self.headers.get("Host", ""))
        if not request_host_allowed(host):
            self._json(403, {"ok": False, "closed": True, "error": PUBLIC_BLOCK_MESSAGE})
            return True
        for header in ("Origin", "Referer"):
            value = self.headers.get(header, "")
            if value and not request_host_allowed(normalize_host(value)):
                self._json(403, {"ok": False, "closed": True, "error": PUBLIC_BLOCK_MESSAGE})
                return True
        return False

    def _json(self, code: int, payload: dict[str, Any], cookie: str | None = None) -> None:
        body = scrub_text(json.dumps(payload)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _needs_password(self, error: str, code: int = 401) -> None:
        self._json(code, {"ok": False, "needsPassword": True, "error": error})

    def _session_ok(self) -> bool:
        return token_ok(read_cookie(self.headers.get("Cookie", "")))

    def _require_session(self) -> bool:
        if not password_configured():
            self._needs_password(PASSWORD_UNSET_MESSAGE, 503)
            return False
        if not self._session_ok():
            self._needs_password("Enter the Command Center password.")
            return False
        return True

    def _session_cookie(self, token: str) -> str:
        host = normalize_host(self.headers.get("Host", ""))
        parts = [
            f"{COOKIE_NAME}={token}",
            "HttpOnly",
            "Path=/api/drive",
            "SameSite=Lax",
            f"Max-Age={COOKIE_MAX_AGE}",
        ]
        if host not in {"localhost", "127.0.0.1", "::1"}:
            parts.append("Secure")
        return "; ".join(parts)

    def _read_raw(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as exc:
            self.close_connection = True
            raise DriveInputError("Send a JSON object.") from exc
        if length < 0 or length > 200_000:
            self.close_connection = True
            raise DriveInputError("Request is too large.")
        return self.rfile.read(length) if length else b""

    def _parse_json(self, raw: bytes, allow_password: bool = False) -> dict[str, Any]:
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DriveInputError("Send a JSON object.") from exc
        if not isinstance(data, dict):
            raise DriveInputError("Send a JSON object.")
        for key in data:
            normalized = str(key).lower().replace("-", "_")
            if allow_password and normalized == "password":
                continue
            if normalized in FORBIDDEN_FIELDS:
                raise DriveInputError("Do not send Google secrets from the browser.")
        return data

    def _path(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _require_secrets(self) -> bool:
        if current_secrets() is None:
            self._json(503, {"ok": False, "error": GOOGLE_UNSET_MESSAGE})
            return False
        return True

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._json(403, {"ok": False, "closed": True, "error": PUBLIC_BLOCK_MESSAGE})

    def do_GET(self) -> None:  # noqa: N802
        if self._blocked():
            return
        path = self._path()
        try:
            if path == "/api/drive/session":
                self._session_status()
                return
            if path == "/api/drive/status":
                self._status()
                return
            if path == "/api/drive/files":
                self._list()
                return
            match = re.fullmatch(r"/api/drive/files/([A-Za-z0-9_-]{8,200})", path)
            if match:
                self._read(match.group(1))
                return
            self._json(404, {"ok": False, "error": "Not found."})
        except DriveInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except DriveError as exc:
            self._json(502, {"ok": False, "error": scrub_text(str(exc))})

    def do_POST(self) -> None:  # noqa: N802
        try:
            raw = self._read_raw()
        except DriveInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return
        if self._blocked():
            return
        if self._path() == "/api/drive/session":
            self._unlock(raw)
            return
        self._write("create", raw)

    def do_PUT(self) -> None:  # noqa: N802
        try:
            raw = self._read_raw()
        except DriveInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return
        if self._blocked():
            return
        self._write("update", raw)

    def _unlock(self, raw: bytes) -> None:
        try:
            data = self._parse_json(raw, allow_password=True)
        except DriveInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return
        if not password_configured():
            self._needs_password(PASSWORD_UNSET_MESSAGE, 503)
            return
        if limited("auth", 8):
            self._needs_password("Too many password attempts. Wait a moment.", 429)
            return
        if not passwords_match(data.get("password")):
            self._needs_password("Wrong password.")
            return
        self._json(200, {"ok": True}, self._session_cookie(issue_token()))

    def _session_status(self) -> None:
        if not self._require_session():
            return
        self._json(200, {"ok": True})

    def _write(self, mode: str, raw: bytes) -> None:
        path = self._path()
        try:
            if not self._require_session():
                return
            if not self._require_secrets():
                return
            data = self._parse_json(raw)
            if limited("write", 20):
                self._json(429, {"ok": False, "error": "Too many Drive writes. Wait a moment."})
                return
            if mode == "create":
                if path != "/api/drive/files":
                    self._json(404, {"ok": False, "error": "Not found."})
                    return
                created = GATEWAY.create_file(str(data.get("name") or ""), str(data.get("content") or ""))
                self._json(200, {"ok": True, "account": ACCOUNT, "file": created})
                return
            match = re.fullmatch(r"/api/drive/files/([A-Za-z0-9_-]{8,200})", path)
            if not match:
                self._json(404, {"ok": False, "error": "Not found."})
                return
            updated = GATEWAY.update_file(match.group(1), str(data.get("content") or ""))
            self._json(200, {"ok": True, "account": ACCOUNT, "file": updated})
        except DriveInputError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except DriveError as exc:
            self._json(502, {"ok": False, "error": scrub_text(str(exc))})

    def _status(self) -> None:
        if not self._require_session():
            return
        if current_secrets() is None:
            self._json(503, {"ok": False, "error": GOOGLE_UNSET_MESSAGE})
            return
        self._json(200, {"ok": True, "closed": False, "account": ACCOUNT, "limit": LIST_LIMIT})

    def _list(self) -> None:
        if not self._require_session():
            return
        if not self._require_secrets():
            return
        if limited("list", 30):
            self._json(429, {"ok": False, "error": "Too many Drive reads. Wait a moment."})
            return
        files = GATEWAY.list_files()[:LIST_LIMIT]
        self._json(200, {"ok": True, "account": ACCOUNT, "limit": LIST_LIMIT, "files": files})

    def _read(self, file_id: str) -> None:
        if not self._require_session():
            return
        if not self._require_secrets():
            return
        if limited("read", 60):
            self._json(429, {"ok": False, "error": "Too many Drive reads. Wait a moment."})
            return
        self._json(200, {"ok": True, "account": ACCOUNT, "file": GATEWAY.read_file(file_id)})


def main() -> None:
    host = env_value("DRIVE_LISTEN_HOST") or "127.0.0.1"
    port_raw = env_value("DRIVE_LISTEN_PORT") or "8788"
    try:
        port = int(port_raw)
    except ValueError:
        print("DRIVE_LISTEN_PORT must be a number.", file=sys.stderr)
        raise SystemExit(1) from None
    if port < 1 or port > 65535 or not listen_host_allowed(host):
        print("Refusing to listen on a public address. Use 127.0.0.1.", file=sys.stderr)
        raise SystemExit(1)
    httpd = ThreadingHTTPServer((host, port), Handler)
    state = "OAuth secret is set" if current_secrets() else "OAuth secret is missing, Drive is closed"
    print(f"Private Drive bridge on http://{host}:{port} — {state}. Account {ACCOUNT}.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()


if __name__ == "__main__":
    main()
