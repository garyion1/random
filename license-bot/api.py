import os
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

import db

API_SHARED_SECRET = os.environ["API_SHARED_SECRET"]

# Auto-revoke a key after this many activation attempts from a *different*
# account than the one it's bound to -- someone repeatedly trying a shared
# key on other accounts is exactly the sharing behavior this is meant to stop.
MAX_MISMATCH_ATTEMPTS = int(os.environ.get("MAX_MISMATCH_ATTEMPTS", "5"))

# Very small per-IP rate limit so the endpoint can't be hammered to brute
# force key guesses or spam the mismatch counter. Not a substitute for a
# real reverse-proxy rate limiter if you're worried about serious abuse.
_RATE_LIMIT = 20  # requests
_RATE_WINDOW = 60  # seconds
_hits: dict[str, deque] = defaultdict(deque)

app = FastAPI(title="TPA Tools License API")


class ValidateRequest(BaseModel):
    key: str
    minecraft_uuid: str
    minecraft_username: str | None = None


class ValidateResponse(BaseModel):
    valid: bool
    reason: str | None = None


def _check_rate_limit(ip: str):
    now = time.monotonic()
    hits = _hits[ip]
    while hits and now - hits[0] > _RATE_WINDOW:
        hits.popleft()
    if len(hits) >= _RATE_LIMIT:
        raise HTTPException(status_code=429, detail="rate_limited")
    hits.append(now)


@app.post("/validate", response_model=ValidateResponse)
def validate(
    req: ValidateRequest,
    x_forwarded_for: str | None = Header(default=None),
    x_api_secret: str = Header(...),
):
    if x_api_secret != API_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="bad_api_secret")

    client_ip = (x_forwarded_for or "unknown").split(",")[0].strip()
    _check_rate_limit(client_ip)

    lic = db.get_license(req.key)
    if lic is None:
        return ValidateResponse(valid=False, reason="unknown_key")

    if lic["revoked"]:
        return ValidateResponse(valid=False, reason="revoked")

    if lic["bound_uuid"] is None:
        db.bind_license(req.key, req.minecraft_uuid, req.minecraft_username)
        return ValidateResponse(valid=True)

    if lic["bound_uuid"] == req.minecraft_uuid:
        return ValidateResponse(valid=True)

    db.record_mismatch(req.key)
    if lic["mismatch_attempts"] + 1 >= MAX_MISMATCH_ATTEMPTS:
        db.revoke_license(req.key)
        return ValidateResponse(valid=False, reason="revoked_too_many_mismatches")

    return ValidateResponse(valid=False, reason="bound_to_another_account")
