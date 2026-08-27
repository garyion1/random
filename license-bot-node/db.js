const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, 'licenses.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    key TEXT PRIMARY KEY,
    discord_user_id TEXT,
    bound_uuid TEXT,
    bound_username TEXT,
    bound_at REAL,
    created_at REAL NOT NULL,
    expires_at REAL,
    revoked INTEGER NOT NULL DEFAULT 0,
    mismatch_attempts INTEGER NOT NULL DEFAULT 0,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS known_hashes (
    sha256 TEXT PRIMARY KEY,
    label TEXT,
    added_at REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tamper_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    minecraft_uuid TEXT,
    jar_sha256 TEXT,
    detected_at REAL NOT NULL
  );
`);

// Migration for databases created before expires_at existed.
try {
  db.exec('ALTER TABLE licenses ADD COLUMN expires_at REAL');
} catch {
  // Column already exists -- fine.
}

// duration -> seconds. null means no expiry (lifetime).
const DURATIONS = {
  '3day': 3 * 24 * 60 * 60,
  monthly: 30 * 24 * 60 * 60,
  lifetime: null,
};

// Unambiguous alphabet: no 0/O, 1/I/L confusion.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateKey() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

function createLicense(discordUserId, note, duration = 'lifetime') {
  if (!(duration in DURATIONS)) {
    throw new Error(`Unknown duration "${duration}", expected one of: ${Object.keys(DURATIONS).join(', ')}`);
  }
  const key = generateKey();
  const now = Date.now() / 1000;
  const seconds = DURATIONS[duration];
  const expiresAt = seconds === null ? null : now + seconds;
  db.prepare(
    'INSERT INTO licenses (key, discord_user_id, created_at, expires_at, note) VALUES (?, ?, ?, ?, ?)'
  ).run(key, discordUserId, now, expiresAt, note ?? null);
  return key;
}

function getLicense(key) {
  return db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);
}

function licensesForUser(discordUserId) {
  return db.prepare('SELECT * FROM licenses WHERE discord_user_id = ?').all(discordUserId);
}

function revokeLicense(key) {
  const info = db.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?').run(key);
  return info.changes > 0;
}

function unbindLicense(key) {
  const info = db
    .prepare(
      `UPDATE licenses
       SET bound_uuid = NULL, bound_username = NULL, bound_at = NULL, mismatch_attempts = 0
       WHERE key = ?`
    )
    .run(key);
  return info.changes > 0;
}

function bindLicense(key, minecraftUuid, minecraftUsername) {
  db.prepare(
    'UPDATE licenses SET bound_uuid = ?, bound_username = ?, bound_at = ? WHERE key = ?'
  ).run(minecraftUuid, minecraftUsername ?? null, Date.now() / 1000, key);
}

function recordMismatch(key) {
  db.prepare('UPDATE licenses SET mismatch_attempts = mismatch_attempts + 1 WHERE key = ?').run(key);
}

function addKnownHash(sha256, label) {
  db.prepare(
    'INSERT OR REPLACE INTO known_hashes (sha256, label, added_at) VALUES (?, ?, ?)'
  ).run(sha256.toLowerCase(), label ?? null, Date.now() / 1000);
}

function removeKnownHash(sha256) {
  const info = db.prepare('DELETE FROM known_hashes WHERE sha256 = ?').run(sha256.toLowerCase());
  return info.changes > 0;
}

function listKnownHashes() {
  return db.prepare('SELECT * FROM known_hashes ORDER BY added_at DESC').all();
}

function isKnownHash(sha256) {
  return !!db.prepare('SELECT 1 FROM known_hashes WHERE sha256 = ?').get(sha256.toLowerCase());
}

function hasAnyKnownHash() {
  return !!db.prepare('SELECT 1 FROM known_hashes LIMIT 1').get();
}

function logTamper(key, minecraftUuid, jarSha256) {
  db.prepare(
    'INSERT INTO tamper_log (key, minecraft_uuid, jar_sha256, detected_at) VALUES (?, ?, ?, ?)'
  ).run(key ?? null, minecraftUuid ?? null, jarSha256, Date.now() / 1000);
}

function recentTamperLog(limit = 10) {
  return db.prepare('SELECT * FROM tamper_log ORDER BY detected_at DESC LIMIT ?').all(limit);
}

module.exports = {
  DURATIONS,
  generateKey,
  createLicense,
  getLicense,
  licensesForUser,
  revokeLicense,
  unbindLicense,
  bindLicense,
  recordMismatch,
  addKnownHash,
  removeKnownHash,
  listKnownHashes,
  isKnownHash,
  hasAnyKnownHash,
  logTamper,
  recentTamperLog,
};
