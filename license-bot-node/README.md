# TPA Tools License Bot (Node.js)

Same design as `license-bot/` (the Python version), ported to Node — a
Discord bot for issuing license keys plus a small HTTP API the mod calls to
check them. A key activates on whichever Minecraft account uses it first;
using the same key from a different account after that is rejected, and
after `MAX_MISMATCH_ATTEMPTS` repeated attempts from other accounts, the key
auto-revokes.

## How it works

- **Discord bot** (`bot.js`): admins run `/genkey @user` to mint a key,
  DM'd to them automatically. Users check their own with `/mykeys`. Admins
  can `/revoke` a key, `/unbind` it (reset to unbound, e.g. for a legitimate
  account change), or `/lookup` one for support.
- **HTTP API** (`api.js`, Express): exposes `POST /validate`, which the mod
  calls on startup with the license key and the player's Minecraft UUID.
- Both run in one process (`index.js`) sharing one SQLite database
  (`licenses.db`, via `better-sqlite3`).

Verified locally: `npm install` installs cleanly, and `POST /validate`
correctly rejects an unknown key and a wrong `X-Api-Secret` before you ever
touch a real Discord token.

## Setup

```bash
cd license-bot-node
npm install
cp .env.example .env
# edit .env: DISCORD_BOT_TOKEN, ADMIN_USER_IDS, API_SHARED_SECRET at minimum
npm start
```

## Deploying on bot-hosting.net (or another Pterodactyl-style panel)

1. Create a **Node.js** server on the panel.
2. Upload everything in this folder (`index.js`, `bot.js`, `api.js`, `db.js`,
   `package.json`) via the file manager or SFTP. Don't upload `node_modules`
   — let the panel run `npm install` itself (most Node eggs do this
   automatically on startup; if not, run it from the panel's console).
3. Set the startup/main file to `index.js`.
4. Set environment variables in the panel's Startup/Variables tab — see
   `.env.example` for the list. **`HTTP_PORT` must match the port allocated
   to you** in the panel's Network/Allocations tab, not an arbitrary number
   — that's the port your Minecraft mod will actually be able to reach from
   outside.
5. Start it. Console should show `License API listening on port <port>`
   followed by `Logged in as <bot tag>`.
6. From your own computer (not the panel), confirm it's reachable:
   ```bash
   curl -X POST http://<panel-ip>:<port>/validate \
     -H "X-Api-Secret: <your secret>" -H "Content-Type: application/json" \
     -d '{"key":"test","minecraft_uuid":"test"}'
   ```
   Expect `{"valid":false,"reason":"unknown_key"}` — that confirms it's up
   and reachable.

**Note on HTTPS:** most bot-hosting panels give you a raw IP:port, not a
domain with TLS. That means the mod would call plain `http://`, not
`https://`. If you want HTTPS without a full VPS, a free Cloudflare Tunnel
pointed at that IP:port works, but needs a domain you control in
Cloudflare's DNS.

## API contract

Identical to the Python version — see `license-bot/README.md` for the full
`POST /validate` request/response shape and the honest limits of this
approach (it stops casual key-sharing; it isn't tamper-proof against someone
willing to patch the client-side check out of their own copy).
