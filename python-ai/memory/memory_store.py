import json
import os
import sqlite3
from pathlib import Path


class MemoryStore:
    def __init__(self):
        self.backend = os.getenv("MEMORY_BACKEND", "memory").lower()
        self._sessions: dict[str, dict] = {}
        self._conn: sqlite3.Connection | None = None

        if self.backend == "sqlite":
            db_path = Path(os.getenv("MEMORY_SQLITE_PATH", "./data/memory.db"))
            db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_memory (
                    session_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            self._conn.commit()

    # --- API usada pelo planner ---

    def get(self, session_id: str) -> dict:
        if not session_id:
            return {}
        if self.backend != "sqlite":
            return self._sessions.get(session_id, {})

        assert self._conn is not None
        row = self._conn.execute(
            "SELECT payload FROM session_memory WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if not row:
            return {}
        try:
            return json.loads(row[0])
        except Exception:
            return {}

    def set(self, session_id: str, data: dict):
        if not session_id:
            return
        if self.backend != "sqlite":
            self._sessions[session_id] = data
            return

        assert self._conn is not None
        payload = json.dumps(data, ensure_ascii=False)
        self._conn.execute(
            """
            INSERT INTO session_memory (session_id, payload, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(session_id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = CURRENT_TIMESTAMP
            """,
            (session_id, payload),
        )
        self._conn.commit()

    def merge(self, session_id: str, data: dict):
        """Atualiza só os campos não nulos sem perder o estado atual da sessão."""
        current = self.get(session_id)
        merged = {**current, **{k: v for k, v in data.items() if v is not None and v != ""}}
        self.set(session_id, merged)

    def clear(self, session_id: str):
        if not session_id:
            return
        if self.backend != "sqlite":
            self._sessions.pop(session_id, None)
            return

        assert self._conn is not None
        self._conn.execute("DELETE FROM session_memory WHERE session_id = ?", (session_id,))
        self._conn.commit()

    # --- Debug / admin ---

    def all_sessions(self) -> dict:
        if self.backend != "sqlite":
            return dict(self._sessions)

        assert self._conn is not None
        rows = self._conn.execute("SELECT session_id, payload FROM session_memory").fetchall()
        result: dict[str, dict] = {}
        for session_id, payload in rows:
            try:
                result[session_id] = json.loads(payload)
            except Exception:
                result[session_id] = {}
        return result