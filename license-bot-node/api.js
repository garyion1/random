const express = require('express');
const db = require('./db');

const API_SHARED_SECRET = process.env.API_SHARED_SECRET;
if (!API_SHARED_SECRET) {
  throw new Error('API_SHARED_SECRET is not set');
}

const MAX_MISMATCH_ATTEMPTS = parseInt(process.env.MAX_MISMATCH_ATTEMPTS || '5', 10);

// If true, a jar hash that doesn't match any registered known-good build
// also fails the license check outright, not just logs+alerts. Off by
// default so a version rollout (before you've run /addhash for the new
// build) doesn't lock out legitimate users.
const DENY_ON_TAMPER = process.env.DENY_ON_TAMPER === 'true';

let tamperNotifier = null;
function setTamperNotifier(fn) {
  tamperNotifier = fn;
}

// Very small per-IP rate limit so the endpoint can't be hammered to brute
// force key guesses or spam the mismatch counter. Not a substitute for a
// real reverse-proxy rate limiter if you're worried about serious abuse.
const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 60_000;
const hits = new Map(); // ip -> timestamps[]

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t <= RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

const app = express();
app.use(express.json());

app.post('/validate', (req, res) => {
  if (req.header('X-Api-Secret') !== API_SHARED_SECRET) {
    return res.status(401).json({ valid: false, reason: 'bad_api_secret' });
  }

  const ip = (req.header('X-Forwarded-For') || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ valid: false, reason: 'rate_limited' });
  }

  const {
    key,
    minecraft_uuid: uuid,
    minecraft_username: username,
    jar_sha256: jarHash,
  } = req.body || {};
  if (!key || !uuid) {
    return res.status(400).json({ valid: false, reason: 'missing_fields' });
  }

  let tamperDetected = false;
  if (jarHash && db.hasAnyKnownHash() && !db.isKnownHash(jarHash)) {
    tamperDetected = true;
    db.logTamper(key, uuid, jarHash);
    if (tamperNotifier) {
      tamperNotifier({ key, uuid, username, jarHash }).catch((e) =>
        console.error('tamper notifier failed:', e)
      );
    }
    if (DENY_ON_TAMPER) {
      return res.json({ valid: false, reason: 'tampered_jar' });
    }
  }

  const lic = db.getLicense(key);
  if (!lic) {
    return res.json({ valid: false, reason: 'unknown_key' });
  }
  if (lic.revoked) {
    return res.json({ valid: false, reason: 'revoked' });
  }

  if (!lic.bound_uuid) {
    db.bindLicense(key, uuid, username);
    return res.json({ valid: true, tamper_detected: tamperDetected });
  }

  if (lic.bound_uuid === uuid) {
    return res.json({ valid: true, tamper_detected: tamperDetected });
  }

  db.recordMismatch(key);
  if (lic.mismatch_attempts + 1 >= MAX_MISMATCH_ATTEMPTS) {
    db.revokeLicense(key);
    return res.json({ valid: false, reason: 'revoked_too_many_mismatches' });
  }

  return res.json({ valid: false, reason: 'bound_to_another_account' });
});

module.exports = { app, setTamperNotifier };
