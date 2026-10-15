# Command Center (synced for Swapr Mix)

Mirror of Simzy420/command-center with **Swapr Mix** added next to **Swapr** in Image gen.

- Live Mix app: https://swapr-mix.vercel.app/
- Production DCC: https://command-center-neon-iota.vercel.app/
- Upstream repo (GitHub Pages): https://github.com/Simzy420/command-center

Cursor agents cannot push to the upstream repo; this copy is deployed via Vercel until those changes land on `Simzy420/command-center` main.

## Login / API deploy rules (read before shipping)

Sign-in (`/api/accounts`) and Drive unlock (`/api/drive/session`) are **bundled Build Output functions** attached by `scripts/attach-drive-function.mjs`.

On 2026-10-15, git deploys from this telegram-repo mirror (`cursor/command-center-swapr-mix-bb0e`) reached production and made both endpoints return `FUNCTION_INVOCATION_FAILED` (HTTP 500). That blocked Dark Command Center login. Production was restored by promoting the last known-good Build Output deploy (`dpl_5rPvYT9FAydMfTZQZkj6HVcm2BmQ`).

Root cause: the repo `package.json` sets `"type": "module"`, so Vercel loaded the bundled CJS `index.js` handlers as ESM (`module is not defined`). Each `.func` directory now ships its own `package.json` with `"type": "commonjs"`.

Before any production alias change:

1. Build with `VERCEL=1 npm run build && node scripts/attach-drive-function.mjs` (the attach step must print that functions were attached and must not throw).
2. Smoke the deployment URL (not only the static shell):
   - `GET /api/accounts` → `200` and `{"ok":true,...}`
   - `POST /api/accounts` with a bad login → `401` JSON error (not 500)
   - `POST /api/drive/session` with `{}` → `401` `needsPassword` (not 500)
3. Prefer a **prebuilt** `.vercel/output` upload over a raw git build when unsure.
4. Never leave production on a deploy whose `/api/accounts` returns 500.
