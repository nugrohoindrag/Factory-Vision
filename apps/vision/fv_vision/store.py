"""Where results go: PostgreSQL when VISION_DATABASE_URL is set, the log otherwise.

A failed write is logged and dropped, never raised: losing a minute of
statistics is better than the detector stopping, and the connection is
reopened on the next write. Alerts are the exception worth noticing, so a
lost alert is logged at ERROR.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from importlib import resources

log = logging.getLogger(__name__)


def _ts(epoch: float | None) -> datetime | None:
    return None if epoch is None else datetime.fromtimestamp(epoch, tz=timezone.utc)


class LogStore:
    """No database: log what would have been written. For local runs."""

    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        self._next_id = 1

    def people_live(self, row: dict) -> None:
        pass

    def people_minute(self, wall_t: float, row: dict) -> None:
        log.info("orang/menit: rata2 %.1f min %d maks %d", row["avg_count"], row["min_count"],
                 row["max_count"])

    def crowd_alert(self, wall_t: float, alert) -> None:
        log.warning("ALERT kerumunan (%s): %d orang, laju %+.1f/menit, ambang %.0f",
                    alert.kind, alert.count, alert.growth_per_min, alert.threshold)

    def weapon_alert(self, wall_t: float, confidence: float, snapshot_path: str | None,
                     model: str) -> int | None:
        alert_id, self._next_id = self._next_id, self._next_id + 1
        log.warning("ALERT potensi senjata tajam #%d: conf %.2f snapshot %s (menunggu verifikasi)",
                    alert_id, confidence, snapshot_path)
        return alert_id

    def zone_live(self, rows: list[dict]) -> None:
        pass

    def zone_minute(self, wall_t: float, rows: list[dict]) -> None:
        for r in rows:
            log.info("zona %s: %s kendaraan %.1f okupansi %.2f", r["zone_id"], r["status"],
                     r["vehicle_count"], r["occupancy"])

    def stream_state(self, state: str, detail: str) -> None:
        log.info("stream %s: %s", state, detail)


class PgStore:
    def __init__(self, url: str, camera_id: str):
        self.url = url
        self.camera_id = camera_id
        self._conn = None
        self._connect()

    def _connect(self):
        import psycopg

        if self._conn is not None and not self._conn.closed:
            return self._conn
        try:
            conn = psycopg.connect(self.url, autocommit=True, connect_timeout=10)
            conn.execute(resources.files("fv_vision").joinpath("schema.sql").read_text("utf-8"))
            self._conn = conn
            log.info("database: connected")
        except Exception as exc:  # noqa: BLE001 - any failure means "try again later"
            log.warning("database: unavailable (%s)", exc)
            self._conn = None
        return self._conn

    def _run(self, what: str, sql: str, params_seq: list[tuple], level=logging.WARNING,
             returning: bool = False):
        if not params_seq:
            return None
        conn = self._connect()
        if conn is None:
            log.log(level, "database: %s dropped (no connection)", what)
            return None
        try:
            with conn.cursor() as cur:
                if returning:
                    cur.execute(sql, params_seq[0])
                    return cur.fetchone()[0]
                cur.executemany(sql, params_seq)
        except Exception as exc:  # noqa: BLE001
            log.log(level, "database: %s failed (%s)", what, exc)
            try:
                conn.close()
            finally:
                self._conn = None
        return None

    def people_live(self, row: dict) -> None:
        self._run("people_live", """
            INSERT INTO people_live (camera_id, updated_at, count, growth_per_min, peak_count,
                                     peak_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (camera_id) DO UPDATE SET
                updated_at = EXCLUDED.updated_at, count = EXCLUDED.count,
                growth_per_min = EXCLUDED.growth_per_min, peak_count = EXCLUDED.peak_count,
                peak_at = EXCLUDED.peak_at
        """, [(self.camera_id, _ts(row["updated_at"]), row["count"], row["growth_per_min"],
               row["peak_count"], _ts(row["peak_at"]))])

    def people_minute(self, wall_t: float, row: dict) -> None:
        self._run("people_log", """
            INSERT INTO people_log (camera_id, ts, avg_count, min_count, max_count)
            VALUES (%s, %s, %s, %s, %s) ON CONFLICT (camera_id, ts) DO NOTHING
        """, [(self.camera_id, _ts(wall_t - wall_t % 60), row["avg_count"], row["min_count"],
               row["max_count"])])

    def crowd_alert(self, wall_t: float, alert) -> None:
        log.warning("ALERT kerumunan (%s): %d orang, laju %+.1f/menit", alert.kind, alert.count,
                    alert.growth_per_min)
        self._run("crowd_alert", """
            INSERT INTO crowd_alert (ts, camera_id, kind, count, growth_per_min, threshold)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, [(_ts(wall_t), self.camera_id, alert.kind, alert.count, alert.growth_per_min,
               alert.threshold)], level=logging.ERROR)

    def weapon_alert(self, wall_t: float, confidence: float, snapshot_path: str | None,
                     model: str) -> int | None:
        alert_id = self._run("weapon_alert", """
            INSERT INTO weapon_alert (ts, camera_id, confidence, snapshot_path, model)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
        """, [(_ts(wall_t), self.camera_id, confidence, snapshot_path, model)],
            level=logging.ERROR, returning=True)
        log.warning("ALERT potensi senjata tajam #%s: conf %.2f (menunggu verifikasi)",
                    alert_id, confidence)
        return alert_id

    def zone_live(self, rows: list[dict]) -> None:
        self._run("zone_live", """
            INSERT INTO zone_live (camera_id, zone_id, updated_at, status, status_since,
                                   vehicle_count, occupancy, avg_speed_px)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (camera_id, zone_id) DO UPDATE SET
                updated_at = EXCLUDED.updated_at, status = EXCLUDED.status,
                status_since = EXCLUDED.status_since, vehicle_count = EXCLUDED.vehicle_count,
                occupancy = EXCLUDED.occupancy, avg_speed_px = EXCLUDED.avg_speed_px
        """, [(self.camera_id, r["zone_id"], _ts(r["updated_at"]), r["status"],
               _ts(r["status_since"]), r["vehicle_count"], r["occupancy"], r["avg_speed_px"])
              for r in rows])

    def zone_minute(self, wall_t: float, rows: list[dict]) -> None:
        minute = _ts(wall_t - wall_t % 60)
        self._run("zone_status", """
            INSERT INTO zone_status (camera_id, zone_id, ts, status, vehicle_count,
                                     occupancy, avg_speed_px)
            VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (camera_id, zone_id, ts) DO NOTHING
        """, [(self.camera_id, r["zone_id"], minute, r["status"], r["vehicle_count"],
               r["occupancy"], r["avg_speed_px"]) for r in rows])

    def stream_state(self, state: str, detail: str) -> None:
        self._run("stream_log", """
            INSERT INTO stream_log (ts, camera_id, state, detail) VALUES (now(), %s, %s, %s)
        """, [(self.camera_id, state, detail)])


def verify(url: str, alert_id: int, decision: str, verified_by: str,
           note: str | None = None) -> None:
    """F4 from the command line, until the dashboard carries the buttons."""
    import psycopg

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(resources.files("fv_vision").joinpath("schema.sql").read_text("utf-8"))
        conn.execute("""
            INSERT INTO weapon_alert_verification (alert_id, decision, verified_by, note)
            VALUES (%s, %s, %s, %s)
        """, (alert_id, decision, verified_by, note))


def pending(url: str, camera_id: str | None = None) -> list[tuple]:
    import psycopg

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(resources.files("fv_vision").joinpath("schema.sql").read_text("utf-8"))
        return conn.execute("""
            SELECT id, ts, camera_id, confidence, snapshot_path, status
              FROM weapon_alert_status
             WHERE status = 'menunggu' AND (%s::text IS NULL OR camera_id = %s)
             ORDER BY ts DESC
        """, (camera_id, camera_id)).fetchall()
