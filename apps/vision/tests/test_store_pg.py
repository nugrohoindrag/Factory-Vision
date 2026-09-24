"""F3 alert -> F4 verification against a real PostgreSQL.

Skipped unless VISION_TEST_DATABASE_URL points at a database the test may
write to (the fv_vision database created by deploy/vision-init.sql).
"""

import os
import time
from types import SimpleNamespace

import psycopg
import pytest

from fv_vision import store

URL = os.environ.get("VISION_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="VISION_TEST_DATABASE_URL not set")


def _status(alert_id):
    with psycopg.connect(URL) as conn:
        return conn.execute("SELECT status, verified_by FROM weapon_alert_status WHERE id = %s",
                            (alert_id,)).fetchone()


def test_weapon_alert_waits_then_takes_the_latest_decision():
    camera = f"test-{time.time_ns()}"
    s = store.PgStore(URL, camera)
    alert_id = s.weapon_alert(time.time(), 0.81, "2026-09-24/x.jpg", "fake.pt")
    assert alert_id is not None
    assert _status(alert_id) == ("menunggu", None)
    assert [r[0] for r in store.pending(URL, camera)] == [alert_id]

    store.verify(URL, alert_id, "tolak", "operator-a")
    assert _status(alert_id) == ("tolak", "operator-a")
    store.verify(URL, alert_id, "konfirmasi", "supervisor-b", "dilihat ulang")
    assert _status(alert_id) == ("konfirmasi", "supervisor-b")
    assert store.pending(URL, camera) == []

    with psycopg.connect(URL) as conn:
        decisions = conn.execute(
            "SELECT decision FROM weapon_alert_verification WHERE alert_id = %s ORDER BY id",
            (alert_id,)).fetchall()
    # Both decisions are kept: the history is the audit trail.
    assert [d[0] for d in decisions] == ["tolak", "konfirmasi"]


def test_crowd_minute_live_and_alert_rows():
    camera = f"test-{time.time_ns()}"
    s = store.PgStore(URL, camera)
    now = time.time()
    s.people_live({"updated_at": now, "count": 12, "growth_per_min": 3.5, "peak_count": 20,
                   "peak_at": now - 60})
    s.people_live({"updated_at": now, "count": 13, "growth_per_min": 1.0, "peak_count": 20,
                   "peak_at": now - 60})
    s.people_minute(now, {"avg_count": 11.5, "min_count": 9, "max_count": 14})
    s.crowd_alert(now, SimpleNamespace(kind="jumlah", count=31, growth_per_min=2.0,
                                       threshold=30))
    with psycopg.connect(URL) as conn:
        assert conn.execute("SELECT count FROM people_live WHERE camera_id = %s",
                            (camera,)).fetchone() == (13,)
        assert conn.execute("SELECT max_count FROM people_log WHERE camera_id = %s",
                            (camera,)).fetchone() == (14,)
        assert conn.execute("SELECT kind, count FROM crowd_alert WHERE camera_id = %s",
                            (camera,)).fetchone() == ("jumlah", 31)


def test_unknown_decision_is_refused_by_the_database():
    s = store.PgStore(URL, f"test-{time.time_ns()}")
    alert_id = s.weapon_alert(time.time(), 0.6, None, "fake.pt")
    with pytest.raises(psycopg.errors.CheckViolation):
        store.verify(URL, alert_id, "mungkin", "operator-a")
