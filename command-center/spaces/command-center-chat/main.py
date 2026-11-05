import hmac
import json
import math
import os
import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

MAX_TEXT = 8000
MAX_HISTORY = 40
MAX_MESSAGES = 200
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)

Status = Literal["queued", "sent", "partial", "final", "error"]


def data_dir() -> Path:
    preferred = Path("/data/chat-sessions")
    try:
        preferred.mkdir(parents=True, exist_ok=True)
        probe = preferred / ".writable"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return preferred
    except OSError:
        fallback = Path("/tmp/chat-sessions")
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


STORE = data_dir()
RATE: dict[str, list[float]] = defaultdict(list)


def is_session_id(value: str) -> bool:
    return bool(value) and 8 <= len(value) <= 80 and UUID_RE.match(value) is not None


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def rate_limited(key: str, max_n: int = 30, window_s: float = 60.0) -> bool:
    now = time.time()
    hits = [t for t in RATE[key] if now - t < window_s]
    hits.append(now)
    RATE[key] = hits
    return len(hits) > max_n


def session_path(session_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", session_id)
    return STORE / f"{safe}.json"


def load_messages(session_id: str) -> list[dict[str, Any]]:
    path = session_path(session_id)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_messages(session_id: str, messages: list[dict[str, Any]]) -> None:
    path = session_path(session_id)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(messages[-MAX_MESSAGES:]), encoding="utf-8")
    tmp.replace(path)


def bearer_ok(authorization: str | None, secret: str) -> bool:
    if not authorization:
        return False
    m = re.match(r"^Bearer\s+(.+)$", authorization.strip(), re.I)
    token = (m.group(1) if m else "").strip()
    if not token or len(token) != len(secret):
        return False
    return hmac.compare_digest(token, secret)


def snapshot_file() -> Path:
    return STORE.parent / "robinhood-snapshot.json"


def load_snapshot() -> dict[str, Any] | None:
    path = snapshot_file()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def save_snapshot(snapshot: dict[str, Any]) -> None:
    path = snapshot_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(snapshot), encoding="utf-8")
    tmp.replace(path)


def refresh_file() -> Path:
    return STORE.parent / "robinhood-refresh.json"


def utc_stamp(moment: datetime | None = None) -> str:
    current = moment or datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(raw: str | None) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_refresh_request() -> str | None:
    path = refresh_file()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    raw = data.get("requestedAt")
    parsed = parse_utc(raw if isinstance(raw, str) else None)
    if parsed is None:
        return None
    return utc_stamp(parsed)


def save_refresh_request(requested_at: str) -> None:
    path = refresh_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps({"requestedAt": requested_at}), encoding="utf-8")
    tmp.replace(path)


def clear_refresh_request() -> None:
    path = refresh_file()
    path.unlink(missing_ok=True)
    path.with_suffix(path.suffix + ".tmp").unlink(missing_ok=True)


def refresh_is_pending(snapshot: dict[str, Any] | None, requested_at: str | None) -> bool:
    """True when a request is waiting on a snapshot that is missing or older than it."""
    requested = parse_utc(requested_at)
    if requested is None:
        return False
    if not snapshot:
        return True
    updated = parse_utc(str(snapshot.get("updatedAt") or ""))
    if updated is None:
        return True
    return requested > updated


def robinhood_payload() -> dict[str, Any]:
    snapshot = load_snapshot()
    requested_at = load_refresh_request()
    pending = refresh_is_pending(snapshot, requested_at)
    body: dict[str, Any] = {"snapshot": snapshot, "refreshPending": pending}
    if pending and requested_at:
        body["refreshRequestedAt"] = requested_at
    return body


# One public refresh per IP inside this window. Phone retries after the ~45s wait.
REFRESH_INTERVAL_S = 15.0


def client_addr(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    host = forwarded or (request.client.host if request.client else "")
    return (host or "unknown")[:80]


def robinhood_secret() -> str:
    """Dedicated secret wins. Otherwise reuse the chat reply secret."""
    dedicated = (os.environ.get("ROBINHOOD_BRIDGE_SECRET") or "").strip()
    if dedicated:
        return dedicated
    return (os.environ.get("CHAT_BRIDGE_SECRET") or "").strip()


def clean_number(value: float | None) -> float | None:
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise HTTPException(400, "Snapshot numbers must be finite.")
    return number


def clean_label(raw: str | None) -> str:
    text = (raw or "").strip()
    if not text or re.fullmatch(r"[\d\s\-]+", text) or text.lower() == "individual":
        return "Individual"
    return text[:40]


def clean_last4(raw: str | None) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-4:]


def clean_symbol(raw: str) -> str:
    symbol = re.sub(r"\s+", "", raw).upper()
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,15}", symbol):
        raise HTTPException(400, "A position symbol is invalid.")
    return symbol


def clean_updated_at(raw: str | None) -> str:
    text = (raw or "").strip()
    if text:
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
        if parsed is not None:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_currency(raw: str | None) -> str:
    text = (raw or "").strip().upper()
    if re.fullmatch(r"[A-Z]{3}", text):
        return text
    return "USD"


class ChatIn(BaseModel):
    sessionId: str
    clientMsgId: str
    botId: str = "chief"
    botName: str = "Chief of Staff"
    text: str = Field(..., min_length=1, max_length=MAX_TEXT)
    history: list[Any] | None = None


class ReplyIn(BaseModel):
    sessionId: str
    clientMsgId: str
    botId: str = "chief"
    text: str = Field("", max_length=MAX_TEXT)
    status: Literal["partial", "final"] = "final"


class PositionIn(BaseModel):
    model_config = {"extra": "ignore"}
    symbol: str = Field(..., min_length=1, max_length=32)
    quantity: float
    avgCost: float | None = None
    price: float | None = None
    marketValue: float | None = None
    dayChangePct: float | None = None


class AccountIn(BaseModel):
    model_config = {"extra": "ignore"}
    label: str = Field(default="", max_length=80)
    last4: str = Field(default="", max_length=64)


class SnapshotIn(BaseModel):
    model_config = {"extra": "ignore"}
    updatedAt: str | None = Field(default=None, max_length=64)
    account: AccountIn | None = None
    totalValue: float | None = None
    equityValue: float | None = None
    cryptoValue: float | None = None
    cash: float | None = None
    currency: str = Field(default="USD", max_length=8)
    positions: list[PositionIn] = Field(default_factory=list, max_length=250)


def normalize_snapshot(body: SnapshotIn) -> dict[str, Any]:
    account = body.account
    positions: list[dict[str, Any]] = []
    for pos in body.positions:
        positions.append(
            {
                "symbol": clean_symbol(pos.symbol),
                "quantity": clean_number(pos.quantity),
                "avgCost": clean_number(pos.avgCost),
                "price": clean_number(pos.price),
                "marketValue": clean_number(pos.marketValue),
                "dayChangePct": clean_number(pos.dayChangePct),
            }
        )
    return {
        "updatedAt": clean_updated_at(body.updatedAt),
        "account": {
            "label": clean_label(account.label if account else None),
            "last4": clean_last4(account.last4 if account else None),
        },
        "totalValue": clean_number(body.totalValue),
        "equityValue": clean_number(body.equityValue),
        "cryptoValue": clean_number(body.cryptoValue),
        "cash": clean_number(body.cash),
        "currency": clean_currency(body.currency),
        "positions": positions,
    }


app = FastAPI(title="Command Center chat bridge", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://simzy420.github.io",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:8787",
        "http://127.0.0.1:8787",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Webhook-Key"],
    max_age=86400,
)


def public_origin(request: Request) -> str:
    host = os.environ.get("SPACE_HOST") or request.headers.get("x-forwarded-host") or request.headers.get("host")
    if not host:
        return str(request.base_url).rstrip("/")
    proto = request.headers.get("x-forwarded-proto") or "https"
    if not host.startswith("http"):
        return f"{proto}://{host}".rstrip("/")
    return host.rstrip("/")


SYSTEM_PROMPTS = {
    "chief": "You are the Chief of Staff for Casey Sims, a builder who runs construction (Sims Construction), crypto trading (Big Brain Ape), and AI automation. You manage a command center with bots: Scout, Sniper, Pulse, Ledger, Shield, Liquid98Bot, and Chief. Be concise, direct, and helpful. Casey uses voice dictation - keep replies short and actionable.",
    "scout": "You are Scout, a reconnaissance bot in Casey's command center. You monitor markets and report opportunities. Be brief and data-driven.",
    "sniper": "You are Sniper, a precision trading bot in Casey's command center. You focus on entry/exit timing. Be concise.",
    "pulse": "You are Pulse, a monitoring bot in Casey's command center. You track system health and alerts. Be brief.",
    "ledger": "You are Ledger, a financial tracking bot in Casey's command center. You manage accounting and reporting. Be concise.",
    "shield": "You are Shield, a security bot in Casey's command center. You monitor threats and protect assets. Be brief.",
    "liquid": "You are Liquid98Bot, a Hyperliquid trading bot in Casey's command center. You trade perpetual futures using the Druckenmiller framework. Be concise.",
}

OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "qwen/qwen-2.5-72b-instruct")


async def forward_webhook(payload: dict[str, Any]) -> None:
    """Call OpenRouter directly instead of the broken Grok webhook."""
    api_key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(503, "Space is missing OPENROUTER_API_KEY.")

    session_id = payload["sessionId"]
    client_msg_id = payload["clientMsgId"]
    bot_id = (payload.get("botId") or "chief").strip() or "chief"
    bot_name = payload.get("botName") or "Chief of Staff"
    user_text = payload.get("text") or ""
    history = payload.get("history") or []

    system_prompt = SYSTEM_PROMPTS.get(bot_id, SYSTEM_PROMPTS["chief"])

    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role = msg.get("role")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": msg.get("text", "")})
    messages.append({"role": "user", "content": user_text})

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENROUTER_MODEL,
                    "messages": messages,
                    "max_tokens": 1000,
                    "temperature": 0.7,
                },
            )
    except httpx.HTTPError as exc:
        await _post_reply(session_id, client_msg_id, bot_id, f"Connection error: {exc}", "error")
        return

    if res.status_code >= 400:
        error_text = f"OpenRouter HTTP {res.status_code}: {res.text[:200]}"
        await _post_reply(session_id, client_msg_id, bot_id, error_text, "error")
        return

    data = res.json()
    reply_text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not reply_text:
        reply_text = f"{bot_name} has no response."

    await _post_reply(session_id, client_msg_id, bot_id, reply_text, "final")


async def _post_reply(session_id: str, client_msg_id: str, bot_id: str, text: str, status: str) -> None:
    """Write reply directly into the session store (no HTTP callback needed)."""
    existing = load_messages(session_id)
    idx = next(
        (i for i, m in enumerate(existing) if m.get("role") == "assistant" and m.get("clientMsgId") == client_msg_id),
        -1,
    )
    if idx >= 0:
        existing[idx] = {**existing[idx], "text": text, "status": status}
    else:
        existing.append({
            "id": new_id("msg"),
            "role": "assistant",
            "botId": bot_id,
            "text": text,
            "clientMsgId": client_msg_id,
            "createdAt": int(time.time() * 1000),
            "status": status,
        })
    save_messages(session_id, existing)


@app.get("/")
@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "command-center-chat",
        "store": str(STORE),
        "hardware": "cpu-basic",
        "robinhood": True,
    }


@app.get("/chat")
@app.get("/api/chat")
def get_chat(sessionId: str = Query(..., min_length=8)) -> dict[str, Any]:
    if not is_session_id(sessionId):
        raise HTTPException(400, "sessionId must be a UUID.")
    return {"messages": load_messages(sessionId)}


@app.post("/chat")
@app.post("/api/chat")
async def post_chat(body: ChatIn, request: Request) -> dict[str, Any]:
    session_id = body.sessionId.strip()
    client_msg_id = body.clientMsgId.strip()
    if not is_session_id(session_id):
        raise HTTPException(400, "sessionId must be a UUID.")
    if not client_msg_id or len(client_msg_id) > 80:
        raise HTTPException(400, "clientMsgId is required.")
    if rate_limited(f"send:{session_id}"):
        raise HTTPException(429, "Too many chat sends. Wait a moment.")

    bot_id = (body.botId or "chief").strip() or "chief"
    bot_name = (body.botName or "Chief of Staff").strip() or "Chief of Staff"
    text = body.text.strip()
    history = (body.history or [])[-MAX_HISTORY:]
    existing = load_messages(session_id)
    already = any(m.get("clientMsgId") == client_msg_id and m.get("role") == "user" for m in existing)
    if not already:
        existing.append(
            {
                "id": new_id("msg"),
                "role": "user",
                "botId": bot_id,
                "text": text,
                "clientMsgId": client_msg_id,
                "createdAt": int(time.time() * 1000),
                "status": "queued",
            }
        )
        save_messages(session_id, existing)

    origin = public_origin(request)
    await forward_webhook(
        {
            "sessionId": session_id,
            "clientMsgId": client_msg_id,
            "botId": bot_id,
            "botName": bot_name,
            "text": text,
            "history": history,
            "replyUrl": f"{origin}/api/chat/reply",
        }
    )

    sent = [
        {**m, "status": "sent"} if m.get("clientMsgId") == client_msg_id and m.get("role") == "user" else m
        for m in load_messages(session_id)
    ]
    save_messages(session_id, sent)
    return {"ok": True, "clientMsgId": client_msg_id}


@app.post("/chat/reply")
@app.post("/api/chat/reply")
def post_reply(body: ReplyIn, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    secret = (os.environ.get("CHAT_BRIDGE_SECRET") or "").strip()
    if not secret:
        raise HTTPException(500, "Space is missing CHAT_BRIDGE_SECRET.")
    if not bearer_ok(authorization, secret):
        raise HTTPException(401, "Unauthorized.")
    session_id = body.sessionId.strip()
    client_msg_id = body.clientMsgId.strip()
    if not is_session_id(session_id):
        raise HTTPException(400, "sessionId must be a UUID.")
    if not client_msg_id or len(client_msg_id) > 80:
        raise HTTPException(400, "clientMsgId is required.")
    if rate_limited(f"reply:{session_id}", 120):
        raise HTTPException(429, "Too many reply posts.")

    existing = load_messages(session_id)
    status: Status = "partial" if body.status == "partial" else "final"
    idx = next(
        (i for i, m in enumerate(existing) if m.get("role") == "assistant" and m.get("clientMsgId") == client_msg_id),
        -1,
    )
    if idx >= 0:
        existing[idx] = {**existing[idx], "text": body.text, "status": status}
    else:
        existing.append(
            {
                "id": new_id("msg"),
                "role": "assistant",
                "botId": (body.botId or "chief").strip() or "chief",
                "text": body.text,
                "clientMsgId": client_msg_id,
                "createdAt": int(time.time() * 1000),
                "status": status,
            }
        )
    save_messages(session_id, existing)
    return {"ok": True, "clientMsgId": client_msg_id, "status": status}


NO_STORE = {"Cache-Control": "no-store"}


@app.get("/robinhood")
@app.get("/api/robinhood")
def get_robinhood() -> JSONResponse:
    return JSONResponse(robinhood_payload(), headers=NO_STORE)


@app.post("/robinhood")
@app.post("/api/robinhood")
async def post_robinhood(request: Request, authorization: str | None = Header(default=None)) -> JSONResponse:
    secret = robinhood_secret()
    if not secret:
        raise HTTPException(500, "Space is missing ROBINHOOD_BRIDGE_SECRET (or CHAT_BRIDGE_SECRET).")
    if not bearer_ok(authorization, secret):
        raise HTTPException(401, "Unauthorized.")
    if rate_limited("robinhood:write", 60):
        raise HTTPException(429, "Too many snapshot posts.")
    raw = await request.body()
    if len(raw) > 256_000:
        raise HTTPException(413, "Snapshot is too large.")
    try:
        body = SnapshotIn.model_validate_json(raw)
    except (ValidationError, UnicodeDecodeError) as exc:
        raise HTTPException(400, "Invalid Robinhood snapshot.") from exc
    snapshot = normalize_snapshot(body)
    save_snapshot(snapshot)
    clear_refresh_request()
    return JSONResponse({"ok": True, "updatedAt": snapshot["updatedAt"]}, headers=NO_STORE)


@app.post("/robinhood/refresh")
@app.post("/api/robinhood/refresh")
def post_robinhood_refresh(request: Request) -> JSONResponse:
    """Public. Phone asks Chief of Staff to pull Robinhood; it never calls Robinhood itself."""
    if rate_limited(f"robinhood:refresh:{client_addr(request)}", max_n=1, window_s=REFRESH_INTERVAL_S):
        raise HTTPException(429, "A refresh was just requested. Wait a few seconds.")
    requested_at = utc_stamp()
    save_refresh_request(requested_at)
    return JSONResponse(
        {"ok": True, "requestedAt": requested_at, "refreshPending": True},
        headers=NO_STORE,
    )


@app.delete("/robinhood/refresh")
@app.delete("/api/robinhood/refresh")
def delete_robinhood_refresh(authorization: str | None = Header(default=None)) -> JSONResponse:
    secret = robinhood_secret()
    if not secret:
        raise HTTPException(500, "Space is missing ROBINHOOD_BRIDGE_SECRET (or CHAT_BRIDGE_SECRET).")
    if not bearer_ok(authorization, secret):
        raise HTTPException(401, "Unauthorized.")
    clear_refresh_request()
    return JSONResponse({"ok": True, "refreshPending": False}, headers=NO_STORE)


@app.get("/robinhood/pending-refresh")
@app.get("/api/robinhood/pending-refresh")
def get_robinhood_pending() -> JSONResponse:
    payload = robinhood_payload()
    body: dict[str, Any] = {"refreshPending": payload["refreshPending"]}
    if "refreshRequestedAt" in payload:
        body["refreshRequestedAt"] = payload["refreshRequestedAt"]
    return JSONResponse(body, headers=NO_STORE)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": detail, "detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def valid_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    robinhood = request.url.path.rstrip("/").endswith("/robinhood")
    message = "Invalid Robinhood snapshot." if robinhood else "Invalid chat payload."
    return JSONResponse(status_code=400, content={"error": message, "detail": exc.errors()})
