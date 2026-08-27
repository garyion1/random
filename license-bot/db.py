import secrets
import sqlite3
import string
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "licenses.db"

# Unambiguous alphabet: no 0/O, 1/I/L confusion.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_key() -> str:
    groups = ["".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(4)]
    return "-".join(groups)


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS licenses (
                key TEXT PRIMARY KEY,
                discord_user_id TEXT,
                bound_uuid TEXT,
                bound_username TEXT,
                bound_at REAL,
                created_at REAL NOT NULL,
                revoked INTEGER NOT NULL DEFAULT 0,
                mismatch_attempts INTEGER NOT NULL DEFAULT 0,
                note TEXT
            )
            """
        )


def create_license(discord_user_id: str | None, note: str | None = None) -> str:
    key = generate_key()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO licenses (key, discord_user_id, created_at, note) VALUES (?, ?, ?, ?)",
            (key, discord_user_id, time.time(), note),
        )
    return key


def get_license(key: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM licenses WHERE key = ?", (key,)).fetchone()


def licenses_for_user(discord_user_id: str) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM licenses WHERE discord_user_id = ?", (discord_user_id,)
        ).fetchall()


def revoke_license(key: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("UPDATE licenses SET revoked = 1 WHERE key = ?", (key,))
        return cur.rowcount > 0


def unbind_license(key: str) -> bool:
    """Clear the bound Minecraft account so the key can activate on a new one."""
    with get_conn() as conn:
        cur = conn.execute(
            """
            UPDATE licenses
            SET bound_uuid = NULL, bound_username = NULL, bound_at = NULL, mismatch_attempts = 0
            WHERE key = ?
            """,
            (key,),
        )
        return cur.rowcount > 0


def bind_license(key: str, minecraft_uuid: str, minecraft_username: str | None):
    with get_conn() as conn:
        conn.execute(
            "UPDATE licenses SET bound_uuid = ?, bound_username = ?, bound_at = ? WHERE key = ?",
            (minecraft_uuid, minecraft_username, time.time(), key),
        )


def record_mismatch(key: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE licenses SET mismatch_attempts = mismatch_attempts + 1 WHERE key = ?",
            (key,),
        )
