---
title: Command Center Chat
emoji: 📡
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
suggested_hardware: cpu-basic
pinned: false
license: mit
---

# Command Center chat bridge (Hugging Face Space)

CPU **basic** Space — **not** ZeroGPU. This is a tiny FastAPI webhook mailbox so the Command Center PWA can talk to Chief of Staff.

Casey pays for Hugging Face. Put secrets on **this Space**, never in the public Command Center repo.

## Production Space (already live)

Do not redeploy to ship the phone client. Production is:

- App: https://simzy-command-center-chat.hf.space
- Page: https://huggingface.co/spaces/Simzy/command-center-chat

Casey sets **`GROK_WEBHOOK_URL`** and **`GROK_WEBHOOK_SENDER_KEY`** on that Space (plus `CHAT_BRIDGE_SECRET` for agent replies). The Command Center PWA defaults to that origin; empty vault on the phone already uses it.

This folder is a reference copy of the bridge app.

## Secrets

**Settings → Secrets** (runtime env, not git):

| Secret | Purpose |
| --- | --- |
| `GROK_WEBHOOK_URL` | Incoming webhook for the Grok Bot “Command Center chat” routine |
| `GROK_WEBHOOK_SENDER_KEY` | Sender key from that routine (`Authorization: Bearer` + `X-Webhook-Key` + `?key=`) |
| `CHAT_BRIDGE_SECRET` | Bearer token the agent must send on `POST /api/chat/reply`. Also accepted on `POST /api/robinhood` when `ROBINHOOD_BRIDGE_SECRET` is unset. |
| `ROBINHOOD_BRIDGE_SECRET` | Optional. When set, `POST /api/robinhood` requires this bearer token and ignores `CHAT_BRIDGE_SECRET`. |

Copy the Grok Bot webhook URL and sender key into the Space secrets. Do **not** paste them into Command Center.

Do **not** put `GMAIL_APP_PASSWORD` on this Space and do **not** add `/api/gmail`. The Space is public. Gmail inbox and send live only on the private mail server in `server/gmail_mail.py`.

Do **not** put `COMMAND_CENTER_PASSWORD`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, or `GOOGLE_DRIVE_REFRESH_TOKEN` on this Space, and do **not** add `/api/drive`. Drive stays on the Vercel server routes.

## API (live Space)

- `GET /health` — `{ ok: true }`
- `POST /api/chat` `{ sessionId, clientMsgId, botId, botName, text, history? }` → `{ ok, clientMsgId }` and forwards JSON to `GROK_WEBHOOK_URL`
- `GET /api/chat?sessionId=` → `{ messages: [...] }`
- `POST /api/chat/reply` `Authorization: Bearer ${CHAT_BRIDGE_SECRET}` `{ sessionId, clientMsgId, botId, text, status: "partial"|"final" }`
- `GET /api/robinhood` → `{ "snapshot": null, "refreshPending": false }` or `{ "snapshot": { ... }, "refreshPending": false }` (no auth, `Cache-Control: no-store`). When a refresh is waiting on a newer snapshot, the body also includes `refreshPending: true` and `refreshRequestedAt`.
- `POST /api/robinhood` `Authorization: Bearer ${ROBINHOOD_BRIDGE_SECRET}` replaces the stored snapshot and clears any pending refresh. If that secret is unset, `CHAT_BRIDGE_SECRET` is accepted instead.
- `POST /api/robinhood/refresh` (public, no auth) stores a pending refresh. Rate limit is one request per 15 seconds per IP. Same path without the `/api` prefix.
- `GET /api/robinhood/pending-refresh` (public) → `{ "refreshPending": bool, "refreshRequestedAt"?: string }` for Chief of Staff to poll without the snapshot body.
- `DELETE /api/robinhood/refresh` uses the same bearer as the snapshot POST and clears the pending file. A successful snapshot POST already clears it.

CORS allows `https://simzy420.github.io` and localhost. Text max 8000. `sessionId` must be a UUID.

The webhook body includes `replyUrl` pointing at this Space’s `/api/chat/reply`.

Account numbers on the Robinhood snapshot are stored as last-4 only. `GET /api/robinhood` is public: anyone who can reach this Space can read the latest snapshot.

### Agent: POST a Robinhood snapshot

```http
POST /api/robinhood
Authorization: Bearer ${ROBINHOOD_BRIDGE_SECRET}
Content-Type: application/json
```

```json
{
  "updatedAt": "2026-09-28T15:04:00Z",
  "account": { "label": "Individual", "last4": "6740" },
  "totalValue": 118532.25,
  "equityValue": 175464.27,
  "cryptoValue": 26130.89,
  "cash": -83062.91,
  "currency": "USD",
  "positions": [
    { "symbol": "PLTR", "quantity": 149.998, "avgCost": 142.02, "price": 178.2, "marketValue": 26729.64, "dayChangePct": 1.2 }
  ]
}
```

Push Casey’s default individual brokerage account. Empty nickname → `"label": "Individual"`. Equity positions only in `positions`. `price` / `marketValue` of `0` or `null` means no live quote.

### Phone refresh (Chief of Staff must fulfill)

The phone never calls Robinhood. **Refresh** does `POST /api/robinhood/refresh`, which writes `robinhood-refresh.json` next to the snapshot:

```json
{ "requestedAt": "2026-09-28T15:04:00Z" }
```

`refreshPending` is true when that file exists and there is no snapshot yet, or `requestedAt` is later than `snapshot.updatedAt`.

Chief of Staff (or a webhook) must notice the pending flag — poll `GET /api/robinhood` or `GET /api/robinhood/pending-refresh` — pull Robinhood, and `POST /api/robinhood` with a new snapshot. That POST clears the pending file. This repo does not change CoS routines. Until the push lands, the phone keeps the last snapshot and, after about 45 seconds, shows a waiting error.
