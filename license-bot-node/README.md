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
  account change), or `/lookup` one for support. "Admin" means listed in
  `ADMIN_USER_IDS`, holding `ADMIN_ROLE_ID`, or — if you set
  `TRUST_SERVER_ADMINS=true` — anyone with the Discord server's own
  Administrator permission. That last one is off by default; only turn it
  on for a server where you trust everyone with that permission to hand out
  and revoke keys.
- **HTTP API** (`api.js`, Express): exposes `POST /validate`, which the mod
  calls on startup (and periodically after that, if you wire up
  `LicenseGate.startPeriodicRecheck` — see `mod-integration/`) with the
  license key and the player's Minecraft UUID. A revoke/unbind takes effect
  on the next recheck, not just on next launch.
- **Tamper detection**: the mod hashes its own jar file and sends that along
  too. Register the hash of every build you actually ship with
  `/addhash <sha256> [label]` (get the hash with `node hash-jar.js
  path/to/tpatools.jar`). Any request carrying a jar hash you haven't
  registered gets logged (`/tamperlog`) and DMs every admin — that's someone
  running a modified copy, most likely one with the license check patched
  out. Until you've registered at least one hash, nothing gets flagged (so a
  fresh deploy doesn't alert on every legitimate user by default).
- Everything runs in one process (`index.js`) sharing one SQLite database
  (`licenses.db`, via `better-sqlite3`).

Verified locally: `npm install` installs cleanly, and `POST /validate`
correctly rejects an unknown key, a wrong `X-Api-Secret`, and correctly
flags+notifies on a jar hash that doesn't match a registered known-good
build (and does nothing when it matches) — tested directly against a
running instance, not just read over.

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

`POST /validate` body now also accepts an optional `jar_sha256` field (see
Tamper detection above); everything else matches the Python version — see
`license-bot/README.md` for the full request/response shape.

## Honest limit of tamper detection

This tells you *that* a file was modified, not who did it beyond whichever
license key and Minecraft account it was used with — and like every check
here, it depends on the mod's own reporting code being intact. Someone
skilled enough to patch out the license check could also patch out (or
spoof) the hash it reports. What it reliably catches is the common case:
someone runs a casually-patched copy without also disabling this specific
reporting call.
