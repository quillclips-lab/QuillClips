"""SQLite storage (WAL). One connection per thread."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from typing import Any, Iterable

from .config import DB_PATH, DEFAULT_SETTINGS

_local = threading.local()

# v1 schema, frozen. Later changes go into MIGRATIONS below; never edit this block.
SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    hash TEXT,
    size INTEGER,
    duration REAL,
    width INTEGER,
    height INTEGER,
    fps REAL,
    has_audio INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'uploaded',
    stage TEXT,
    progress REAL DEFAULT 0,
    error TEXT,
    analysis TEXT,
    streamer TEXT,
    options TEXT,
    streamer_id TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    start REAL NOT NULL,
    end REAL NOT NULL,
    score INTEGER,
    selection TEXT,
    metadata TEXT,
    render_opts TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT,
    progress REAL DEFAULT 0,
    error TEXT,
    file_path TEXT,
    thumb_path TEXT,
    duration REAL,
    shared TEXT DEFAULT '{}',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS clips_video ON clips(video_id);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT,
    progress REAL DEFAULT 0,
    error TEXT,
    attempts INTEGER DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS streamers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    instagram TEXT,
    defaults TEXT DEFAULT '{}',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claude_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    model TEXT,
    purpose TEXT,
    duration_ms INTEGER,
    ok INTEGER,
    error TEXT,
    cost_usd REAL,
    prompt_chars INTEGER,
    preview TEXT
);
"""

JSON_FIELDS = {"analysis", "streamer", "options", "selection", "metadata", "render_opts", "shared", "payload",
               "edl", "platforms", "person"}


def _columns(c: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()}


def _migrate_v2(c: sqlite3.Connection) -> None:
    """v2: streamer profiles -> campaigns; brief/exclude on videos; EDL on clips."""
    c.execute("""
        CREATE TABLE IF NOT EXISTS campaigns (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            cpm REAL NOT NULL,
            platforms TEXT NOT NULL DEFAULT '[]',
            drive_url TEXT,
            person TEXT DEFAULT '{}',
            notes TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )""")
    vcols = _columns(c, "videos")
    for col in ("brief", "exclude", "campaign_id"):
        if col not in vcols:
            c.execute(f"ALTER TABLE videos ADD COLUMN {col} TEXT")
    if "streamer_id" in vcols:
        c.execute("ALTER TABLE videos DROP COLUMN streamer_id")
    ccols = _columns(c, "clips")
    for col in ("campaign_id", "edl"):
        if col not in ccols:
            c.execute(f"ALTER TABLE clips ADD COLUMN {col} TEXT")
    c.execute("CREATE INDEX IF NOT EXISTS clips_campaign ON clips(campaign_id)")
    # streamer profiles had no link/CPM, so they cannot become campaigns: drop them
    c.execute("DROP TABLE IF EXISTS streamers")


MIGRATIONS = [
    lambda c: c.executescript(SCHEMA),  # v1: initial schema
    _migrate_v2,
]


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA busy_timeout=30000")
        _local.conn = c
    return c


def init() -> None:
    """Apply pending migrations (tracked with PRAGMA user_version)."""
    c = conn()
    version = c.execute("PRAGMA user_version").fetchone()[0]
    if version == 0 and "videos" in {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
        version = 1  # databases created before migrations existed already have the v1 schema
    for i, migrate in enumerate(MIGRATIONS[version:], start=version + 1):
        migrate(c)
        c.execute(f"PRAGMA user_version={i}")
        c.commit()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> float:
    return time.time()


def _decode(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for k in JSON_FIELDS & d.keys():
        if isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except json.JSONDecodeError:
                pass
    return d


def _encode(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def query(sql: str, params: Iterable = ()) -> list[dict]:
    return [_decode(r) for r in conn().execute(sql, tuple(params)).fetchall()]


def one(sql: str, params: Iterable = ()) -> dict | None:
    return _decode(conn().execute(sql, tuple(params)).fetchone())


def execute(sql: str, params: Iterable = ()) -> int:
    c = conn()
    cur = c.execute(sql, tuple(params))
    c.commit()
    return cur.rowcount


def insert(table: str, row: dict) -> dict:
    keys = list(row.keys())
    execute(
        f"INSERT INTO {table} ({','.join(keys)}) VALUES ({','.join('?' for _ in keys)})",
        [_encode(row[k]) for k in keys],
    )
    return row


def update(table: str, id_: str, **fields: Any) -> None:
    if not fields:
        return
    if table in ("videos", "clips", "jobs"):
        fields["updated_at"] = now()
    sets = ",".join(f"{k}=?" for k in fields)
    execute(f"UPDATE {table} SET {sets} WHERE id=?", [*(_encode(v) for v in fields.values()), id_])


# ---------------------------------------------------------------- settings

def get_settings() -> dict:
    out = dict(DEFAULT_SETTINGS)
    for r in conn().execute("SELECT key, value FROM settings").fetchall():
        try:
            out[r["key"]] = json.loads(r["value"])
        except json.JSONDecodeError:
            out[r["key"]] = r["value"]
    return out


def save_settings(values: dict) -> dict:
    c = conn()
    for k, v in values.items():
        if k in DEFAULT_SETTINGS:
            c.execute("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (k, json.dumps(v)))
    c.commit()
    return get_settings()
