# Dark Command Center

Phone-first PWA for commanding a bot roster. **Use mode is the default** — you chat and drive widgets. **Observe Only** is an optional spectator overlay that animates named avatars toward active widget regions. It is never the only interaction path.

Boards live in a JSON layout store (`id`, `type`, `x`, `y`, `w`, `h`, `page`, `settings`). The grid is not hard-coded. Adding a widget is a registry entry, not a rewrite of the board.

## Run

```bash
npm install
npm run dev      # Vite dev server
npm run build    # typecheck + production PWA build
npm run preview  # serve dist
```

Install as a PWA from Safari/Chrome on iPhone or iPad (Add to Home Screen). The service worker caches the app shell so the last saved layout still opens offline (layout JSON is in `localStorage`).

Live (GitHub Pages): https://simzy420.github.io/command-center/

## Product rules (v1)

- Roster (labels under geometric avatars): Scout, Sniper, Pulse, Ledger, Shield, Liquid98Bot, Chief of Staff.
- Avatars use the three ref styles: cyan ringed sphere, purple energy pyramid, fragmented lightning cube.
- 2-column grid on phone, 12-column on desktop.
- Long-press / drag from the **widget header in Edit mode**. Use mode does not capture drag, so the page scrolls normally.
- No fake prices, charts, EMAs, P&L, or emails. The watchlist shows live CoinGecko USD price and 24h change only — no candles. The Robinhood widget shows the latest portfolio snapshot pushed to the chat Space — account total and equity positions, with quotes only when that snapshot includes them. Gmail lists the newest 25 messages from the private mail server, or stays closed until that server has `GMAIL_APP_PASSWORD`. Google Drive lists the newest 25 files after the Drive section password checks out on the server. The rest of the app stays open. The Trading stub still shows **Connect data source**.
- No App Store binary, no unrestricted iframes, no live wallet signing, no fake live trading, no real payment backend.
- Owner plan persists to `localStorage`. Guest/unpaid sees **Preview mode — upgrade to save** (billing is a stub in System).

## Layout JSON

Export/import from **System** (drawer). Shape:

```json
{
  "version": 1,
  "boards": [
    { "id": "home", "title": "Home" },
    { "id": "trading", "title": "Trading" },
    { "id": "bots", "title": "Bots" },
    { "id": "media", "title": "Media" },
    { "id": "links", "title": "Links" }
  ],
  "widgets": [
    {
      "id": "w_abc",
      "type": "chat",
      "x": 0,
      "y": 0,
      "w": 12,
      "h": 8,
      "page": "home",
      "settings": { "selectedBotIds": ["chief"] }
    }
  ],
  "updatedAt": 0
}
```

Coordinates are stored in **12-column** space. On a phone they compress to 2 columns (`w >= 6` becomes full width). Tear down the starter Home board in Edit mode whenever you want — reset from System.

## How to add a new widget (under 15 minutes)

You never edit the grid component to place a widget. The board only looks up `type` in the registry.

1. **Create the view** — `src/components/widgets/MyWidget.tsx`

```tsx
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import type { WidgetRenderProps } from '@/registry/types';

export function MyWidget({ widget }: WidgetRenderProps) {
  return (
    <WidgetFrame widget={widget} title="My widget">
      {/* read/write widget.settings via useLayoutStore.getState().updateSettings */}
      <p>Hello from {widget.id}</p>
    </WidgetFrame>
  );
}
```

2. **Register it** — add one `registerWidget({...})` call in `src/registry/index.ts`. Copy an existing block; set `type`, `title`, `defaultSize` (`w`/`h` in 12-col units), and `component`.

3. **Optional feature flag** — set `featureFlag: 'tradingStub'` so a widget only appears in the add sheet when that flag is on in System. Gmail is a normal widget and is always in the add sheet.

4. **Use it** — tap **+** on the dock (or stay in Edit mode) and pick the widget. It is appended to the current board JSON. Drag the header to place it.

That is the whole grid contract. `GridBoard` maps `widget.type` → `getWidget(type).component`. No layout file to update.

## Swap real AI / image providers

Adapters sit behind interfaces so mocks can be replaced without touching widgets.

| Concern | Interface | Default | Swap point |
| --- | --- | --- | --- |
| Chat streaming | `ChatAdapter` | Chief of Staff bridge (`src/adapters/chat/bridge.ts`). Mock only if `VITE_CHAT_MOCK=1` | `src/adapters/chat/index.ts` (`getChatAdapter`) |
| Image generation | `ImageGenAdapter` | Pollinations unless stills are switched to OpenAI | `src/adapters/imagegen/index.ts` (`getImageGenAdapter`) |
| Image-to-video | Wan 2.2 Gradio client | Public Space `kulkas2pintu/wan222` (no token) | `src/adapters/wan/gradio.ts` |
| Watchlist quotes | `MarketAdapter` | CoinGecko public `simple/price` (no key, no mock) | `src/adapters/market/index.ts` (`getMarketAdapter`) |

A replacement adapter must implement the same interface as the one it swaps. Widgets already consume those modules.

### Image gen keys

- **GitHub Pages (this PWA):** stills default to **Pollinations (free)** — no key. Switch to **OpenAI** in the Image gen widget or **System → Image vault**, then paste a key. The choice is `cc.v1.imageProvider`. The key stays in this browser’s `localStorage` (`cc.v1.vault.openai`). Never commit keys. Pollinations does not read the key.
- **Vercel:** set `OPENAI_API_KEY` in the project Environment Variables (server only). Set `VITE_IMAGE_PROXY=1` so choosing **OpenAI** calls `/api/generate-image` instead of sending a key from the phone. **Pollinations (free)** still skips that proxy. Host at the deployment root so the proxy path works.

Do not put `OPENAI_API_KEY` in any `VITE_` variable or client source.

### Watchlist (CoinGecko)

The watchlist calls the public CoinGecko API from the phone. No API key. No mock prices, candles, EMAs, or P&L.

```
https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,hyperliquid&vs_currencies=usd&include_24hr_change=true
```

CoinGecko sends `Access-Control-Allow-Origin: *`, so GitHub Pages calls it directly. A fresh browser with no `cc.v1.watchlist` key starts on BTC, ETH, SOL, and HYPE (`hyperliquid`). Add and remove persist in that key. The empty state appears only after every symbol is removed.

Unknown tickers resolve through `/search` (highest market-cap exact symbol match). Quotes refresh about every 60 seconds and from the refresh button. A failed fetch shows the CoinGecko error and keeps the last good quotes on screen. Those quotes are not written to `localStorage`.

Optional override: `VITE_MARKET_API_BASE` — a root that serves the same `/simple/price` and `/search` paths. Leave it unset for the public API.

### Wan 2.2 (image-to-video)

Image gen has a **Stills | Wan 2.2 | Wan Extend | Swapr** switch (saved as `cc.v1.imageModel`: `stills`, `wan22`, `wanExtend`, or `swapr`). On a phone the four choices sit in a 2×2 grid. **Perchance (free)** sits under that switch and opens [perchance.org/ai-photo-generator](https://perchance.org/ai-photo-generator) in a new tab. It does not replace those generators. Stills have a **Pollinations (free) | OpenAI** switch (saved as `cc.v1.imageProvider`). Wan 2.2 calls the public Gradio Space [kulkas2pintu/wan222](https://huggingface.co/spaces/kulkas2pintu/wan222) from the browser — no Hugging Face token. ZeroGPU often takes 1–3 minutes. If the host blocks CORS, the widget embeds the Space (`?embed=true`) and links **Open in Space**. Generated clips are stored in `cc.v1.videos` and copied into the Files **Media** folder.

**Wan Extend** opens the Runpod-backed Space [simzy-wan22-extend](https://simzy-wan22-extend.hf.space/) in a new tab and embeds it when the Space allows framing. **Swapr** opens [wan22-templates.vercel.app](https://wan22-templates.vercel.app/) the same way (Become the Character / Wan Animate on Runpod). The phone does not call Runpod. The first run can take a few minutes while the Runpod worker starts.

### Real chat (Chief of Staff)

Casey talks to **Chief of Staff** in the Chat widget. The phone never calls Grok directly. It POSTs to the **Hugging Face Space**; the Space wakes the Grok Bot webhook; the agent POSTs the reply back to the Space; the widget polls until it lands.

Default bot id is `chief`. Placeholder: **Message Chief of Staff…** Default adapter is the real bridge (`src/adapters/chat/bridge.ts`). Mock only if `VITE_CHAT_MOCK=1`.

**Production host is the Hugging Face Space** — **not Vercel, not ZeroGPU**. Vercel is unused for chat. `api/generate-image.ts` remains only as an optional later OpenAI stills proxy.

| | |
| --- | --- |
| Space app | https://simzy-command-center-chat.hf.space |
| Space page | https://huggingface.co/spaces/Simzy/command-center-chat |

The phone client already defaults to that origin. Casey does **not** have to type it. Resolution order: System vault `cc.v1.vault.chatApiBase` → `VITE_CHAT_API_BASE` → `https://simzy-command-center-chat.hf.space`.

**Local demo only:** `VITE_CHAT_MOCK=1` restores the old mock adapter. Without that flag, Chat hits the live Space — no fake witty lines.

#### 1. Space secrets (Casey)

On [Simzy/command-center-chat](https://huggingface.co/spaces/Simzy/command-center-chat) → **Settings → Secrets** (never commit, never paste into the phone):

| Secret | Purpose |
| --- | --- |
| `GROK_WEBHOOK_URL` | Incoming webhook for the Grok Bot “Command Center chat” routine |
| `GROK_WEBHOOK_SENDER_KEY` | Sender key from that routine |
| `CHAT_BRIDGE_SECRET` | Bearer token the agent sends on `POST /api/chat/reply` |

The Space is already live. Do not redeploy it for the phone client. A copy of the bridge app lives in [`spaces/command-center-chat/`](spaces/command-center-chat/) for reference.

#### 2. Grok Bot webhook routine

Create / use the Grok Bot routine **Command Center chat**. Copy its webhook URL and sender key into the **Space secrets** above — not into git, not into System.

Webhook POST body:

```json
{
  "sessionId": "uuid",
  "clientMsgId": "uuid",
  "botId": "chief",
  "botName": "Chief of Staff",
  "text": "Casey's message",
  "history": [],
  "replyUrl": "https://simzy-command-center-chat.hf.space/api/chat/reply"
}
```

When the bot has an answer:

```http
POST /api/chat/reply
Authorization: Bearer ${CHAT_BRIDGE_SECRET}
Content-Type: application/json

{"sessionId":"uuid","clientMsgId":"uuid","botId":"chief","text":"…","status":"final"}
```

`status` may be `"partial"` then `"final"`.

#### 3. Phone client

On GitHub Pages (`https://simzy420.github.io/command-center/`):

- Empty vault already uses `https://simzy-command-center-chat.hf.space`.
- Optional override in **System → Chat bridge** (`cc.v1.vault.chatApiBase`).
- Optional build env: `VITE_CHAT_API_BASE=https://simzy-command-center-chat.hf.space` (documented in `.env.example`).

The client only talks to `{space}/api/chat`. Webhook secrets stay on the Space.

#### API (live Space)

- `GET /health` → `{ ok: true }`
- `POST /api/chat` `{ sessionId, clientMsgId, botId, botName, text, history? }` → `{ ok: true, clientMsgId }`
- `GET /api/chat?sessionId=` → `{ messages: [{ id, role, botId, text, clientMsgId, createdAt, status }] }`
- `POST /api/chat/reply` Bearer `CHAT_BRIDGE_SECRET`

Text max 8000 characters. `sessionId` must be a UUID. CORS allows the Pages origin and localhost.

### Robinhood snapshot (same Space)

The phone cannot call Robinhood or the Grok Bot Robinhood MCP. There is no Robinhood login in the Vite client. Chief of Staff (or a routine that already has the Robinhood MCP) **pushes** a portfolio snapshot to this Space. The Robinhood widget re-reads that snapshot about every 30 seconds. **Refresh** asks the Space for a new pull and waits until a newer snapshot arrives.

Host is the same chat Space. `api/generate-image.ts` is still unrelated. Do not add a second host.

| | |
| --- | --- |
| GET (public) | `https://simzy-command-center-chat.hf.space/api/robinhood` |
| POST refresh (public) | `https://simzy-command-center-chat.hf.space/api/robinhood/refresh` |
| POST snapshot (bearer) | `https://simzy-command-center-chat.hf.space/api/robinhood` |

Phone resolution: System vault chat base → `VITE_CHAT_API_BASE` → the default Space, then `/api/robinhood`. Optional override: `VITE_ROBINHOOD_API_BASE` (origin only). **Never** put `ROBINHOOD_BRIDGE_SECRET`, `CHAT_BRIDGE_SECRET`, or a Robinhood token in a `VITE_` variable or in the phone vault.

#### Space secret

On the Space → **Settings → Secrets**:

| Secret | Purpose |
| --- | --- |
| `ROBINHOOD_BRIDGE_SECRET` | Bearer token for `POST /api/robinhood`. Set this to use a secret that is not the chat reply token. |
| `CHAT_BRIDGE_SECRET` | Used for `POST /api/robinhood` **only when `ROBINHOOD_BRIDGE_SECRET` is unset**. Chat replies always use this secret, not the Robinhood one. |

GET is open so the phone can poll. Anyone who can reach the Space URL can read the latest snapshot. Snapshot POST and `DELETE /api/robinhood/refresh` use the bearer token. The public refresh POST is rate-limited (about one per 15 seconds per IP) and only stores a timestamp. The stored account id is last-4 digits only.

**Refresh** does not call Robinhood. It stores a pending request. Chief of Staff must see `refreshPending` on `GET /api/robinhood` (or `GET /api/robinhood/pending-refresh`), pull Robinhood, and POST a new snapshot. That POST clears the pending file. Until then the widget keeps the last numbers, spins, and after about 45 seconds shows a waiting error.

This repo does not deploy the Space. Copy `spaces/command-center-chat/` onto [Simzy/command-center-chat](https://huggingface.co/spaces/Simzy/command-center-chat) or the widget will keep reporting that `/api/robinhood` is missing.

#### Agent: push a snapshot

Use Casey’s **default individual** brokerage account (`brokerage_account_type` individual, `is_default`). If the nickname is empty, send `"label": "Individual"`. Send equity stock positions. Include `price` / `marketValue` only when you have a quote; `0` or `null` means no quote and the widget shows an em dash. `cryptoValue` is optional.

```http
POST https://simzy-command-center-chat.hf.space/api/robinhood
Authorization: Bearer ${ROBINHOOD_BRIDGE_SECRET}
Content-Type: application/json
```

If `ROBINHOOD_BRIDGE_SECRET` is not set on the Space, send `CHAT_BRIDGE_SECRET` instead. POST replaces the stored snapshot and clears a pending refresh. GET returns `{ "snapshot": null, "refreshPending": false }` until the first successful POST, then `{ "snapshot": { ... }, "refreshPending": false }`. A waiting refresh adds `"refreshPending": true` and `"refreshRequestedAt"`.

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

The widget treats a snapshot older than 10 minutes as stale (`Updated 12m ago`). Empty state: **Waiting for first sync…**

## Gmail

The **Gmail** section is a normal board widget. Open it from the **+** add-widget menu (the word Gmail is set in Fraunces, a serif, not the Sora body font). It is locked to `caseylsims@gmail.com`, lists only the newest 25 messages, opens one to show the body, and can send with To, subject, and body. From is always that mailbox.

The phone never holds the app password. It calls same-origin `/api/gmail/*` only when the page is not a public host (GitHub Pages, the Hugging Face Space, Vercel, Netlify, Cloudflare Pages). On those hosts the widget stays closed and does not request the inbox or send.

Mail itself is `server/gmail_mail.py` (IMAP `imap.gmail.com:993`, SMTP `smtp.gmail.com:465`). It reads `GMAIL_APP_PASSWORD` from the environment of that process. Until the variable is set, inbox and send return closed and do not log in. The process binds to `127.0.0.1:8787` (override with a private `GMAIL_LISTEN_HOST` only). It does not send CORS headers, and it rejects requests whose Host, Origin, or Referer is a public site. Do not add these routes to the chat Space, and do not put the secret in a `VITE_` variable, GitHub Pages, or this repo.

```bash
# On the private machine only. The value is an environment variable, not a file in git.
GMAIL_APP_PASSWORD='your-google-app-password' npm run mail-server
npm run dev   # Vite proxies /api/gmail to 127.0.0.1:8787
```

Open Command Center at `http://127.0.0.1:5173/command-center/` (or another private host that reverse-proxies `/api/gmail` to that process). GitHub Pages will keep showing the closed state after this ships. A custom private hostname must match `GMAIL_PRIVATE_HOST` on the mail server. Do not publish port 8787.

## Game

**Game** is a normal board widget. Open it from the **+** add-widget menu. The button is labeled **Game** and opens this Claude artifact in a new tab:

https://claude.ai/code/artifact/e0be7c72-8356-45f3-a242-90e73c1ff645?org=ab3580a3-ad7b-4517-a457-271ef6ae591c

The artifact page could not be read from here. The HTML title is only “Claude Artifact,” the frame host returns 404, and Claude’s page will not allow another site to embed it (`frame-ancestors 'self'`). The game itself is not included in this app. Claude may ask you to sign in before it loads.

## Google Drive

The **Google Drive** section is a separate board widget from Files. Open it from the **+** add-widget menu. The title stays “Google Drive”. It is locked to `caseylsims@gmail.com`. It lists the newest 25 files (folders and trash omitted), opens one to show its text, **Save** creates a text file or updates a text file already in Drive, and **Send** hands the open text to this phone’s share sheet (Messages, Mail, AirDrop) or downloads it when the browser has no share sheet. The on-device Files widget is unchanged.

The rest of Command Center stays open. Only the Google Drive section asks for a password. Wrong or missing password gets no file list, no save, and no send. The phone never holds the password or a Google secret. Logging out or switching profiles clears the Drive session cookie, so the next profile does not inherit the unlock. It calls same-origin `/api/drive/*` on the Vercel site. The server checks `COMMAND_CENTER_PASSWORD` and only then talks to Google. GitHub Pages and the chat Space have no Drive server, so those hosts still show nothing from Drive.

Drive on the Vercel site is the serverless route under `api/drive/`. It talks to the **Google Drive API v3** (`https://www.googleapis.com/drive/v3`) with OAuth scope `https://www.googleapis.com/auth/drive`. The narrower `drive.file` scope cannot see files this app did not create, so the route uses the full Drive scope. `npm run dev` serves the same route. `server/drive_api.py` is the optional loopback bridge and uses the same password check.

| Secret | Where it lives |
| --- | --- |
| `COMMAND_CENTER_PASSWORD` | Vercel project environment (server only). Also the environment of `npm run dev` or `server/drive_api.py` when you run them yourself. |
| `GOOGLE_DRIVE_CLIENT_ID` | Same server environment |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Same server environment |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Same server environment |

There is no service-account key in this repo. Do not put any of those values in a `VITE_` variable, GitHub Pages, the chat Space, or git.

Until `COMMAND_CENTER_PASSWORD` is set, the Drive section accepts no password and returns no files. After the right password, list, open, and save still return no files until the three Google variables are set, and they do not call Google before that. The route sends no CORS headers. Google Docs, Sheets, and Slides open as exported text. Save writes a new `.txt` file for those, because the bridge does not overwrite Google’s own file types. Text files update in place.

One-time consent, on the private machine:

1. In Google Cloud, enable the **Google Drive API**.
2. Create an OAuth client of type **Desktop**. On the consent screen, add `caseylsims@gmail.com` as a test user while the app is in testing.
3. Add redirect URI `http://127.0.0.1:8799/`.
4. Export the client id and secret in the shell, then print the consent URL:

```bash
GOOGLE_DRIVE_CLIENT_ID='...' GOOGLE_DRIVE_CLIENT_SECRET='...' python3 server/drive_auth.py
```

5. Open that URL while signed in as `caseylsims@gmail.com` and approve Drive access. The browser will land on `http://127.0.0.1:8799/?code=...` (the page itself does not load). Copy the `code` value.
6. Exchange it. The refresh token is printed in the terminal only:

```bash
GOOGLE_DRIVE_CLIENT_ID='...' GOOGLE_DRIVE_CLIENT_SECRET='...' python3 server/drive_auth.py --code 'CODE'
```

7. On the **Vercel project** for the phone site, set these environment variables for Production (and Preview if you use preview URLs). Do not prefix them with `VITE_`.

```text
COMMAND_CENTER_PASSWORD
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
```

Redeploy after saving them. That is the deploy step. The phone opens the Vercel site, adds **Google Drive**, and enters `COMMAND_CENTER_PASSWORD`. Files, chat, and the other sections stay usable with no password.

Local check, with the same variables in the shell and not in a file that gets committed:

```bash
npm run dev
```

`npm run drive-server` remains the optional loopback bridge on `127.0.0.1:8788`. It also requires `COMMAND_CENTER_PASSWORD` before it lists or writes. Do not publish port 8788. GitHub Pages still has no Drive API.

## Files

The Files widget on Home is the file section. Tap a file to open it and read the contents. **Open File** brings up this phone’s Downloads / Files picker so you can pull text downloads back into the current folder; the first pick opens for reading. **Save** writes the text back into that file (or creates one from **File** after you name it, then Save). Notes stay in this browser’s `cc.v1.files` storage. They are not uploaded to GitHub Pages, Vercel, or the chat Space, so a stranger on the public site cannot read them. Images and videos belong in Photo gallery, not Open File.

**Send** hands the open file off the app. When the phone browser can share, it opens the system share sheet (Messages, Mail, AirDrop, and the other apps on that phone). When it cannot, the file downloads into that browser’s downloads. A video clip stored as a link is shared as that link; the clip bytes stay where the link points. There is no cloud file account and no secret.

**Open downloads** jumps out to this phone’s Files app Downloads folder (iCloud Downloads on iPhone/iPad, the Download folder on Android) so you can see everything Send already saved there. On a computer it tells you to use the browser’s downloads instead.

## Profiles

The main page is Casey's owner board. Visitors can look at it without an account. They cannot add, remove, rearrange, import, or reset it.

System includes a **Profiles** section under AI Tools. Anyone can create an account with a username and password, or log in. The password is sent only to this site's `/api/accounts` route. The server hashes it with scrypt and stores the hash, the session hashes, and that account's layout in a private Vercel Blob (`BLOB_READ_WRITE_TOKEN`). The password is not stored. The token is not in the app or a `VITE_` variable. The browser keeps an HttpOnly session cookie for 14 days. Logging in later returns the same layout JSON (`id`, `type`, `x`, `y`, `w`, `h`, `page`, `settings`). A new account starts empty. It does not reset to the starter and it does not write Casey's board.

GitHub Pages has no account API, so that host stays on the view-only owner board. Local `npm run dev` stores the same server file under `.data/` (gitignored) so sign-in works without Blob. The Vercel project is connected to a private Blob store named `command-center-accounts`. `BLOB_READ_WRITE_TOKEN` is set on that project for production, preview, and development. It is not in the repo and it is not a `VITE_` variable. A deployment created after that connection can create accounts. If the token is missing, signup returns 503 and the owner board stays available.

## AI Tools

The side menu is the drawer opened from the menu button at the top left, or from **System** on the dock. The first item is labeled **AI Tools**. Opening it lists ChatGPT, Base44, Cursor, Buffer, Linear, Replit, Perplexity, and Link. Each row uses that tool’s name and opens its site in a new tab. Link opens the App Store page.

## Shell map

| Piece | Where |
| --- | --- |
| Top bar (search stub, active bot, Use/Edit, Observe Only pill) | `src/components/shell/TopBar.tsx` |
| Entity swarm + named avatars | `src/components/shell/EntitySwarm.tsx` |
| JSON grid | `src/components/shell/GridBoard.tsx` |
| Side drawer (AI Tools, profiles, boards, export/import, billing stub, image vault, chat bridge, flags) | `src/components/shell/SideDrawer.tsx` |
| Mobile dock | `src/components/shell/MobileDock.tsx` |
| Bot SVGs | `src/components/avatars/BotAvatar.tsx` |
| Persistence gate | `src/store/persist.ts` + session `plan` |

Built-in types: `chat`, `files`, `todo`, `links`, `imagegen`, `watchlist`, `robinhood`, `gmail`, `game`, `drive`, plus the flagged `trading` empty stub. Gmail, Game, and Google Drive are in the add sheet without a feature flag. The owner board visitors see is the shipped starter. A signed-in profile builds a separate board from that same list. Google Drive is not seeded onto the starter boards. The starter Home and Trading boards include Robinhood. A saved `cc.v1.layout` that predates Robinhood gains the widget once (`cc.v1.robinhoodBoardSeed`). Profile boards are stored apart from that key.

## Persistence keys

All keys are prefixed `cc.v1.` in `localStorage`: `layout`, `files`, `todos`, `links`, `watchlist`, `chat`, `chatSession`, `images`, `imageModel`, `imageProvider`, `videos`, `activity`, `session`, `vault.openai`, `vault.chatApiBase`, `robinhoodBoardSeed`. Guests keep in-memory edits only (the image vault and Chat API base still save when you tap Save). File contents live in `files` on this device only. Watchlist prices and the Robinhood snapshot are not stored — the phone only keeps the layout. The snapshot lives on the Space. Account boards and password hashes are not in `localStorage`. They live in the server account store. An older on-device `profiles` key is leftover from a previous draft and is not migrated; create the account again on the Vercel site. Signing in does not write `layout`. The Drive section password is not written into an account.
