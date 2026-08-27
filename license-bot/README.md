# TPA Tools License Bot

A Discord bot for issuing license keys plus a small HTTP API the mod calls to
check them. A key activates on whichever Minecraft account uses it first;
after that, using the same key from a different account is rejected (and
after `MAX_MISMATCH_ATTEMPTS` repeated attempts from other accounts, the key
auto-revokes).

## How it works

- **Discord bot** (`bot.py`): admins run `/genkey @user` to mint a key, which
  gets DM'd to them. Users can check their own keys with `/mykeys`. Admins
  can `/revoke` or `/unbind` (reset to unbound, e.g. if someone legitimately
  changes Minecraft accounts) a key with `/unbind`, and `/lookup` a key for
  support.
- **HTTP API** (`api.py`): exposes `POST /validate`, which the mod calls on
  startup with the license key and the player's Minecraft UUID. See
  `mod-integration/LicenseGate.java` for the client side.
- Both run in one process (`main.py`) sharing one SQLite database
  (`licenses.db`).

## Setup

```bash
cd license-bot
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env: DISCORD_BOT_TOKEN, ADMIN_USER_IDS, API_SHARED_SECRET at minimum
python main.py
```

This starts the Discord bot and the HTTP API (default port 8000) together.

## Putting it behind HTTPS

The mod will be sending license keys over the network, so don't expose the
API over plain HTTP. Put a reverse proxy in front of it on your host —
easiest option is [Caddy](https://caddyfile.com/), which gets you free
automatic TLS with a one-line config:

```
license.yourdomain.com {
    reverse_proxy localhost:8000
}
```

Point the mod at `https://license.yourdomain.com/validate`.

## Running it as a persistent service

On a Linux host, a simple systemd unit keeps it running and restarts it on
crash/reboot:

```ini
[Unit]
Description=TPA Tools License Bot
After=network.target

[Service]
WorkingDirectory=/opt/tpa-license-bot
ExecStart=/opt/tpa-license-bot/venv/bin/python main.py
Restart=on-failure
EnvironmentFile=/opt/tpa-license-bot/.env

[Install]
WantedBy=multi-user.target
```

## API contract

`POST /validate`

Headers: `X-Api-Secret: <API_SHARED_SECRET>`

Body:
```json
{ "key": "ABCD-EFGH-JKLM-NPQR", "minecraft_uuid": "...", "minecraft_username": "..." }
```

Response:
```json
{ "valid": true }
```
or
```json
{ "valid": false, "reason": "bound_to_another_account" }
```

Possible `reason` values: `unknown_key`, `revoked`, `bound_to_another_account`,
`revoked_too_many_mismatches`.

## Honest limits of this approach

This stops the common case — someone borrows a friend's key/jar and it just
doesn't activate for them. It is not tamper-proof: since the check runs
inside your own client-side jar, someone with enough reverse-engineering
skill could patch the check out of their local copy. Server-side per-account
binding plus revocation is the standard, proportionate approach most paid
Minecraft mods use — there's no fully unbeatable client-side DRM.
