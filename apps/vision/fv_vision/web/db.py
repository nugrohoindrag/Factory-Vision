"""One shared database connection for the dashboard.

psycopg connections are thread-safe (calls serialise on the connection), and
a demo dashboard serves a handful of operators, so one autocommit connection
reopened on failure is enough; no pool to size.
"""

from __future__ import annotations

import logging
import threading
from importlib import resources

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger(__name__)


class Database:
    def __init__(self, url: str):
        self.url = url
        self._conn: psycopg.Connection | None = None
        self._lock = threading.Lock()

    def _connection(self) -> psycopg.Connection:
        with self._lock:
            if self._conn is None or self._conn.closed:
                self._conn = psycopg.connect(self.url, autocommit=True, row_factory=dict_row,
                                             connect_timeout=10)
            return self._conn

    def ensure_schema(self) -> None:
        sql = resources.files("fv_vision").joinpath("schema.sql").read_text("utf-8")
        self._connection().execute(sql)

    def all(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        return self._run(sql, params, fetch="all")

    def one(self, sql: str, params: tuple | dict = ()) -> dict | None:
        return self._run(sql, params, fetch="one")

    def execute(self, sql: str, params: tuple | dict = ()) -> None:
        self._run(sql, params, fetch=None)

    def _run(self, sql, params, fetch):
        for attempt in (1, 2):
            conn = self._connection()
            try:
                cur = conn.execute(sql, params)
                if fetch == "all":
                    return cur.fetchall()
                if fetch == "one":
                    return cur.fetchone()
                return None
            except psycopg.OperationalError:
                # A dropped connection: reopen once, then let it raise.
                with self._lock:
                    self._conn = None
                if attempt == 2:
                    raise
        return None
