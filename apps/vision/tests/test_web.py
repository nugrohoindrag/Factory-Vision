"""Dashboard API against a real PostgreSQL.

Skipped unless VISION_TEST_DATABASE_URL points at a database the test may
write to (the fv_vision database created by deploy/vision-init.sql).
"""

import json
import os
import time
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from fv_vision.web.app import Settings, create_app
from fv_vision.web.auth import hash_password

URL = os.environ.get("VISION_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="VISION_TEST_DATABASE_URL not set")

CSRF = {"X-FV-Request": "1"}
PASSWORD = "correct-horse-battery"


@pytest.fixture()
def env(tmp_path: Path):
    tag = f"t{time.time_ns()}"
    camera = f"cam-{tag}"
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / f"{camera}.yaml").write_text(
        f"camera_id: {camera}\nsource: http://example.invalid/stream.m3u8\ncrowd:\n  alert_count: 9\n",
        encoding="utf-8")
    snaps = tmp_path / "snapshots"
    (snaps / "2026-09-24").mkdir(parents=True)
    (snaps / "2026-09-24" / "a.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    (tmp_path / "secret.txt").write_text("nope")
    live = tmp_path / "live"
    live.mkdir()
    (live / f"{camera}.json").write_text(json.dumps(
        {"camera_id": camera, "wall": time.time(), "fps": 2.0, "stream_up": True, "people": 4}))

    settings = Settings(database_url=URL, config_dir=config_dir, snapshot_dir=snaps,
                        live_dir=live, session_secret="test-secret", cookie_secure=False,
                        session_hours=1, admin_user=None, admin_password=None,
                        admin_name="Admin")
    user = f"op-{tag}"
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute("INSERT INTO dashboard_user (username, display_name, role, password_hash) "
                     "VALUES (%s, 'Operator', 'operator', %s)", (user, hash_password(PASSWORD)))
    with TestClient(create_app(settings)) as client:
        yield client, user, camera


def _login(client, user, password=PASSWORD, headers=CSRF):
    return client.post("/api/login", json={"username": user, "password": password},
                       headers=headers)


def _audit(user, action):
    with psycopg.connect(URL) as conn:
        return conn.execute("SELECT target, detail FROM audit_log WHERE username = %s AND "
                            "action = %s ORDER BY id", (user, action)).fetchall()


def test_everything_needs_a_session(env):
    client, _, camera = env
    assert client.get("/", follow_redirects=False).headers["location"] == "/login"
    for path in ("/api/me", "/api/cameras", f"/api/cameras/{camera}/live", "/api/alerts",
                 "/api/export/alerts.csv"):
        res = client.get(path)
        assert res.status_code == 401, path
        assert res.json()["error"]["message"]


def test_login_needs_the_csrf_header_and_the_right_password(env):
    client, user, _ = env
    assert _login(client, user, headers={}).status_code == 403
    assert _login(client, user, "wrong-password").status_code == 401
    assert _audit(user, "login_gagal")
    res = _login(client, user)
    assert res.status_code == 200
    assert "httponly" in res.headers["set-cookie"].lower()
    assert client.get("/api/me").json()["username"] == user


def test_repeated_failures_lock_the_account_for_a_minute(env):
    client, user, _ = env
    for _ in range(5):
        _login(client, user, "wrong-password")
    assert _login(client, user).status_code == 429


def test_a_disabled_account_loses_its_session_at_once(env):
    client, user, _ = env
    _login(client, user)
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute("UPDATE dashboard_user SET disabled = true WHERE username = %s", (user,))
    assert client.get("/api/me").status_code == 401


def test_live_state_and_camera_thresholds(env):
    client, user, camera = env
    _login(client, user)
    cams = client.get("/api/cameras").json()
    assert [c["id"] for c in cams] == [camera]
    assert cams[0]["crowd"]["alertCount"] == 9
    live = client.get(f"/api/cameras/{camera}/live").json()
    assert live["people"] == 4 and live["stale"] is False
    assert client.get("/api/cameras/nope/live").status_code == 404


def test_verifying_a_weapon_alert_records_who_and_is_audited(env):
    client, user, camera = env
    _login(client, user)
    with psycopg.connect(URL, autocommit=True) as conn:
        alert_id = conn.execute(
            "INSERT INTO weapon_alert (ts, camera_id, confidence, snapshot_path, model) "
            "VALUES (now(), %s, 0.7, '2026-09-24/a.jpg', 'm') RETURNING id", (camera,)).fetchone()[0]
    path = f"/api/alerts/senjata/{alert_id}/verify"
    assert client.post(path, json={"decision": "tolak"}).status_code == 403  # no CSRF header
    assert client.post(path, json={"decision": "mungkin"}, headers=CSRF).status_code == 422
    res = client.post(path, json={"decision": "tolak", "note": "payung"}, headers=CSRF)
    assert res.status_code == 200
    body = res.json()
    assert (body["status"], body["verifiedBy"], body["note"]) == ("tolak", user, "payung")
    listed = client.get(f"/api/alerts?camera={camera}&type=senjata").json()
    assert listed[0]["status"] == "tolak"
    assert _audit(user, "verifikasi_senjata")[0][0] == f"weapon_alert:{alert_id}"


def test_snapshots_are_served_only_from_the_snapshot_directory(env):
    client, user, camera = env
    _login(client, user)
    ok = client.get(f"/api/snapshots/{camera}/2026-09-24/a.jpg")
    assert ok.status_code == 200 and ok.content.startswith(b"\xff\xd8")
    for bad in ("../secret.txt", "..%2Fsecret.txt", "2026-09-24/../../secret.txt", "nope.jpg"):
        assert client.get(f"/api/snapshots/{camera}/{bad}").status_code == 404, bad


def test_csv_export_opens_in_excel_and_is_audited(env):
    client, user, camera = env
    _login(client, user)
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute("INSERT INTO crowd_alert (ts, camera_id, kind, count, growth_per_min, "
                     "threshold) VALUES (now(), %s, 'jumlah', 12, 1, 9)", (camera,))
    res = client.get(f"/api/export/alerts.csv?camera={camera}")
    assert res.status_code == 200
    assert res.text.startswith("﻿waktu_wib,kamera,tipe")
    assert f",{camera},kerumunan,jumlah,12," in res.text
    target, detail = _audit(user, "ekspor_alert")[-1]
    assert target == camera and detail["rows"] == 1 and detail["start"] is None


def test_pages_carry_the_security_headers(env):
    client, _, _ = env
    res = client.get("/login")
    assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
    assert "'unsafe-inline'" not in res.headers["content-security-policy"]
    assert res.headers["x-frame-options"] == "DENY"
