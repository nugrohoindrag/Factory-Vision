"""HTTP API, live view and WebSocket for the CV Vision dashboard."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import config as config_mod
from .auth import (COOKIE, CSRF_HEADER, MIN_PASSWORD, LoginThrottle, Sessions, User,
                   check_password, hash_password)
from .db import Database

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
WIB = timezone(timedelta(hours=7))
# A live file older than this means the worker or the stream has stopped.
LIVE_STALE_SECONDS = 20
WS_INTERVAL_SECONDS = 2.0


@dataclass
class Settings:
    database_url: str
    config_dir: Path
    snapshot_dir: Path | None
    live_dir: Path | None
    session_secret: str | None
    cookie_secure: bool
    session_hours: float
    admin_user: str | None
    admin_password: str | None
    admin_name: str

    @classmethod
    def from_env(cls) -> "Settings":
        cfg = os.environ.get("VISION_CONFIG")
        config_dir = os.environ.get("VISION_CONFIG_DIR") or (str(Path(cfg).parent) if cfg
                                                              else "config")
        env_path = lambda name: Path(os.environ[name]) if os.environ.get(name) else None  # noqa: E731
        url = os.environ.get("VISION_DATABASE_URL")
        if not url:
            raise SystemExit("VISION_DATABASE_URL is required for the dashboard")
        return cls(
            database_url=url,
            config_dir=Path(config_dir),
            snapshot_dir=env_path("VISION_SNAPSHOT_DIR"),
            live_dir=env_path("VISION_LIVE_DIR"),
            session_secret=os.environ.get("VISION_SESSION_SECRET"),
            cookie_secure=os.environ.get("VISION_COOKIE_SECURE", "0") == "1",
            session_hours=float(os.environ.get("VISION_SESSION_HOURS", "12")),
            admin_user=os.environ.get("VISION_ADMIN_USER"),
            admin_password=os.environ.get("VISION_ADMIN_PASSWORD"),
            admin_name=os.environ.get("VISION_ADMIN_NAME", "Administrator"),
        )


class LoginBody(BaseModel):
    username: str
    password: str


class VerifyBody(BaseModel):
    decision: str
    note: str | None = None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = Database(settings.database_url)
    sessions = Sessions(settings.session_secret, settings.session_hours)
    throttle = LoginThrottle()
    cameras = _load_cameras(settings)

    @asynccontextmanager
    async def lifespan(_app):
        await asyncio.to_thread(db.ensure_schema)
        await asyncio.to_thread(_bootstrap_admin, db, settings)
        yield

    app = FastAPI(title="CV Vision", docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)
    app.state.db = db

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        # Camera streams play straight from their own host (https:), hls.js
        # comes from jsdelivr; nothing is inline.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: https:; "
            "connect-src 'self' https: wss: ws:; worker-src 'self' blob:; "
            "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    # --- auth plumbing ------------------------------------------------------

    def audit(user: str | None, action: str, target: str | None = None, **detail) -> None:
        try:
            db.execute("INSERT INTO audit_log (username, action, target, detail) "
                       "VALUES (%s, %s, %s, %s)", (user, action, target, json.dumps(detail)))
        except Exception as exc:  # noqa: BLE001 - an audit failure is logged, not fatal
            log.error("audit write failed (%s %s): %s", action, target, exc)

    def load_user(token: str | None) -> User | None:
        username = sessions.read(token)
        if not username:
            return None
        row = db.one("SELECT username, display_name, role FROM dashboard_user "
                     "WHERE username = %s AND NOT disabled", (username,))
        return User(**row) if row else None

    def current_user(request: Request) -> User:
        user = load_user(request.cookies.get(COOKIE))
        if user is None:
            raise HTTPException(401, "Sesi berakhir, silakan masuk lagi")
        return user

    def csrf(request: Request) -> None:
        if request.headers.get(CSRF_HEADER) != "1":
            raise HTTPException(403, "Permintaan ditolak")

    def camera_or_404(camera_id: str) -> config_mod.Config:
        cam = cameras.get(camera_id)
        if cam is None:
            raise HTTPException(404, "Kamera tidak dikenal")
        return cam

    def live_dir(cam: config_mod.Config) -> Path:
        return settings.live_dir or cam.live_dir

    def snapshot_dir(cam: config_mod.Config) -> Path:
        return settings.snapshot_dir or cam.snapshot_dir

    @app.exception_handler(HTTPException)
    async def _http_error(request: Request, exc: HTTPException):
        # The MES envelope, so a front end written against either reads both.
        return JSONResponse({"error": {"code": exc.status_code, "message": exc.detail}},
                            status_code=exc.status_code)

    # --- pages ----------------------------------------------------------------

    @app.get("/", include_in_schema=False)
    def index(request: Request):
        if load_user(request.cookies.get(COOKIE)) is None:
            return RedirectResponse("/login", status_code=303)
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/login", include_in_schema=False)
    def login_page():
        return FileResponse(STATIC / "login.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        db.one("SELECT 1 AS ok")
        return {"ok": True}

    # --- session --------------------------------------------------------------

    @app.post("/api/login", dependencies=[Depends(csrf)])
    def login(body: LoginBody, request: Request, response: Response):
        ip = request.client.host if request.client else "?"
        username = body.username.strip().lower()
        if throttle.blocked(f"u:{username}", f"ip:{ip}"):
            raise HTTPException(429, "Terlalu banyak percobaan, coba lagi dalam 1 menit")
        row = db.one("SELECT password_hash, disabled FROM dashboard_user WHERE username = %s",
                     (username,))
        if row is None or row["disabled"] or not check_password(body.password,
                                                                row["password_hash"]):
            throttle.fail(f"u:{username}", f"ip:{ip}")
            audit(username, "login_gagal", ip=ip)
            raise HTTPException(401, "Nama pengguna atau kata sandi salah")
        throttle.clear(f"u:{username}", f"ip:{ip}")
        response.set_cookie(COOKIE, sessions.issue(username), max_age=sessions.max_age,
                            httponly=True, samesite="lax", secure=settings.cookie_secure)
        audit(username, "login", ip=ip)
        return {"ok": True}

    @app.post("/api/logout", dependencies=[Depends(csrf)])
    def logout(response: Response, user: User = Depends(current_user)):
        response.delete_cookie(COOKIE)
        audit(user.username, "logout")
        return {"ok": True}

    @app.get("/api/me")
    def me(user: User = Depends(current_user)):
        return {"username": user.username, "displayName": user.display_name, "role": user.role}

    # --- cameras and live -----------------------------------------------------

    @app.get("/api/cameras")
    def list_cameras(user: User = Depends(current_user)):
        return [_camera_json(cam) for cam in cameras.values()]

    @app.get("/api/cameras/{camera_id}/live")
    def live(camera_id: str, user: User = Depends(current_user)):
        return _live_state(live_dir(camera_or_404(camera_id)), camera_id)

    @app.get("/api/cameras/{camera_id}/live.mjpg")
    async def live_mjpeg(camera_id: str, request: Request, user: User = Depends(current_user)):
        path = live_dir(camera_or_404(camera_id)) / f"{camera_id}.jpg"
        return StreamingResponse(_mjpeg(path, request),
                                 media_type="multipart/x-mixed-replace; boundary=frame",
                                 headers={"Cache-Control": "no-store"})

    @app.get("/api/cameras/{camera_id}/people")
    def people(camera_id: str, range: str = Query("today", pattern="^(1h|today|7d)$"),
               user: User = Depends(current_user)):
        camera_or_404(camera_id)
        if range == "7d":
            rows = db.all("""
                SELECT date_trunc('hour', ts) AS t, avg(avg_count) AS avg,
                       min(min_count) AS min, max(max_count) AS max
                  FROM people_log
                 WHERE camera_id = %s AND ts >= now() - interval '7 days'
                 GROUP BY 1 ORDER BY 1""", (camera_id,))
        else:
            since = ("now() - interval '1 hour'" if range == "1h" else
                     "(date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') "
                     "AT TIME ZONE 'Asia/Jakarta')")
            rows = db.all(f"""
                SELECT ts AS t, avg_count AS avg, min_count AS min, max_count AS max
                  FROM people_log WHERE camera_id = %s AND ts >= {since} ORDER BY ts""",
                          (camera_id,))
        return [{"t": r["t"].isoformat(), "avg": float(r["avg"]), "min": int(r["min"]),
                 "max": int(r["max"])} for r in rows]

    # --- alerts ---------------------------------------------------------------

    @app.get("/api/alerts")
    def alerts(camera: str | None = None, type: str = Query("semua", pattern="^(semua|kerumunan|senjata)$"),
               start: date | None = None, end: date | None = None,
               limit: int = Query(50, ge=1, le=1000), user: User = Depends(current_user)):
        return _alerts(db, camera, type, start, end, limit)

    @app.post("/api/alerts/senjata/{alert_id}/verify", dependencies=[Depends(csrf)])
    def verify(alert_id: int, body: VerifyBody, user: User = Depends(current_user)):
        if body.decision not in ("konfirmasi", "tolak"):
            raise HTTPException(422, "Keputusan harus konfirmasi atau tolak")
        if db.one("SELECT id FROM weapon_alert WHERE id = %s", (alert_id,)) is None:
            raise HTTPException(404, "Alert tidak ditemukan")
        note = (body.note or "").strip()[:500] or None
        db.execute("INSERT INTO weapon_alert_verification (alert_id, decision, verified_by, note) "
                   "VALUES (%s, %s, %s, %s)", (alert_id, body.decision, user.username, note))
        audit(user.username, "verifikasi_senjata", f"weapon_alert:{alert_id}",
              decision=body.decision, note=note)
        return _alerts(db, None, "senjata", None, None, 1, alert_id=alert_id)[0]

    @app.get("/api/snapshots/{camera_id}/{path:path}")
    def snapshot(camera_id: str, path: str, user: User = Depends(current_user)):
        root = snapshot_dir(camera_or_404(camera_id)).resolve()
        target = (root / path).resolve()
        if root not in target.parents or target.suffix.lower() != ".jpg" or not target.is_file():
            raise HTTPException(404, "Snapshot tidak ditemukan")
        audit(user.username, "lihat_snapshot", f"{camera_id}/{path}")
        return FileResponse(target, headers={"Cache-Control": "private, max-age=3600"})

    # --- exports --------------------------------------------------------------

    @app.get("/api/export/alerts.csv")
    def export_alerts(camera: str | None = None,
                      type: str = Query("semua", pattern="^(semua|kerumunan|senjata)$"),
                      start: date | None = None, end: date | None = None,
                      user: User = Depends(current_user)):
        rows = _alerts(db, camera, type, start, end, 100_000)
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["waktu_wib", "kamera", "tipe", "keterangan", "jumlah_orang", "laju_per_menit",
                    "ambang", "confidence", "status", "diverifikasi_oleh", "waktu_verifikasi_wib",
                    "detik_ke_verifikasi", "catatan"])
        for a in rows:
            w.writerow([_wib(a["ts"]), a["camera"], a["type"], a.get("kind") or "",
                        a.get("count", ""), a.get("growthPerMin", ""), a.get("threshold", ""),
                        a.get("confidence", ""), a.get("status", ""), a.get("verifiedBy") or "",
                        _wib(a.get("verifiedAt")), a.get("secondsToVerify") or "",
                        a.get("note") or ""])
        audit(user.username, "ekspor_alert", camera, type=type, start=_iso(start), end=_iso(end),
              rows=len(rows))
        return _csv(out.getvalue(), "alert-cv-vision.csv")

    @app.get("/api/export/people.csv")
    def export_people(camera: str, start: date | None = None, end: date | None = None,
                      user: User = Depends(current_user)):
        camera_or_404(camera)
        where, params = _date_range("ts", start, end)
        rows = db.all(f"SELECT ts, avg_count, min_count, max_count FROM people_log "
                      f"WHERE camera_id = %s {where} ORDER BY ts", (camera, *params))
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["waktu_wib", "kamera", "rata_rata", "minimum", "maksimum"])
        for r in rows:
            w.writerow([_wib(r["ts"].isoformat()), camera, f"{r['avg_count']:.1f}",
                        r["min_count"], r["max_count"]])
        audit(user.username, "ekspor_jumlah_orang", camera, start=_iso(start), end=_iso(end),
              rows=len(rows))
        return _csv(out.getvalue(), f"jumlah-orang-{camera}.csv")

    # --- push -------------------------------------------------------------------

    @app.websocket("/ws")
    async def ws(socket: WebSocket, camera: str):
        user = await asyncio.to_thread(load_user, socket.cookies.get(COOKIE))
        cam = cameras.get(camera)
        if user is None or cam is None:
            await socket.close(code=4401)
            return
        await socket.accept()
        await asyncio.to_thread(audit, user.username, "pantau", camera)
        last = await asyncio.to_thread(_latest_alert_ids, db)
        try:
            while True:
                state = _live_state(live_dir(cam), camera)
                await socket.send_json({"type": "live", "data": state})
                fresh, last = await asyncio.to_thread(_new_alerts, db, last)
                if fresh:
                    await socket.send_json({"type": "alerts", "data": fresh})
                await asyncio.sleep(WS_INTERVAL_SECONDS)
        except (WebSocketDisconnect, RuntimeError):
            return

    return app


# --- helpers ------------------------------------------------------------------

def _load_cameras(settings: Settings) -> dict[str, config_mod.Config]:
    cams = {}
    for path in sorted(settings.config_dir.glob("*.yaml")):
        try:
            cfg = config_mod.load(path)
            cams[cfg.camera_id] = cfg
        except Exception as exc:  # noqa: BLE001 - one bad file must not hide the others
            log.error("camera config %s skipped: %s", path, exc)
    if not cams:
        log.warning("no camera configs in %s", settings.config_dir)
    return cams


def _bootstrap_admin(db: Database, settings: Settings) -> None:
    """The first admin, from the environment, only while no account exists."""
    if db.one("SELECT 1 AS x FROM dashboard_user LIMIT 1"):
        return
    if not (settings.admin_user and settings.admin_password):
        log.warning("no dashboard accounts yet: set VISION_ADMIN_USER / VISION_ADMIN_PASSWORD, "
                    "or run `python -m fv_vision user add`")
        return
    if len(settings.admin_password) < MIN_PASSWORD:
        log.error("VISION_ADMIN_PASSWORD is shorter than %d characters: not created", MIN_PASSWORD)
        return
    db.execute("INSERT INTO dashboard_user (username, display_name, role, password_hash) "
               "VALUES (%s, %s, 'admin', %s) ON CONFLICT DO NOTHING",
               (settings.admin_user.strip().lower(), settings.admin_name,
                hash_password(settings.admin_password)))
    log.info("dashboard: created admin %s", settings.admin_user)


def _camera_json(cam: config_mod.Config) -> dict:
    return {
        "id": cam.camera_id,
        "source": cam.source,
        "crowd": {"enabled": cam.crowd.enabled, "alertCount": cam.crowd.alert_count,
                  "alertGrowthPerMin": cam.crowd.alert_growth_per_min,
                  "alertHoldSeconds": cam.crowd.alert_hold_seconds},
        "weapon": {"enabled": cam.weapon.enabled and bool(cam.weapon.model),
                   "minPersonHeightPx": cam.weapon.min_person_height_px},
        "zones": [{"id": z.id, "name": z.name} for z in cam.traffic.zones]
                 if cam.traffic.enabled else [],
    }


def _live_state(directory: Path, camera_id: str) -> dict:
    path = directory / f"{camera_id}.json"
    try:
        state = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {"camera_id": camera_id, "available": False, "stale": True}
    state["available"] = True
    state["age_seconds"] = round(time.time() - state.get("wall", 0), 1)
    state["stale"] = state["age_seconds"] > LIVE_STALE_SECONDS
    return state


async def _mjpeg(path: Path, request: Request):
    last_mtime = 0.0
    while not await request.is_disconnected():
        try:
            mtime = path.stat().st_mtime
            if mtime != last_mtime:
                data = path.read_bytes()
                last_mtime = mtime
                yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                       + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
        except OSError:
            pass
        await asyncio.sleep(0.15)


def _date_range(column: str, start: date | None, end: date | None) -> tuple[str, list]:
    """Whole WIB days, start and end inclusive."""
    where, params = "", []
    if start:
        where += f" AND {column} >= %s"
        params.append(datetime.combine(start, datetime.min.time(), WIB))
    if end:
        where += f" AND {column} < %s"
        params.append(datetime.combine(end + timedelta(days=1), datetime.min.time(), WIB))
    return where, params


def _alerts(db: Database, camera: str | None, kind: str, start: date | None, end: date | None,
            limit: int, alert_id: int | None = None) -> list[dict]:
    out: list[dict] = []
    cam_sql = " AND camera_id = %s" if camera else ""
    cam_params = [camera] if camera else []
    where, params = _date_range("ts", start, end)
    if kind in ("semua", "kerumunan") and alert_id is None:
        for r in db.all(f"SELECT id, ts, camera_id, kind, count, growth_per_min, threshold "
                        f"FROM crowd_alert WHERE true{cam_sql}{where} ORDER BY ts DESC LIMIT %s",
                        (*cam_params, *params, limit)):
            out.append({"type": "kerumunan", "id": r["id"], "ts": r["ts"].isoformat(),
                        "camera": r["camera_id"], "kind": r["kind"], "count": r["count"],
                        "growthPerMin": round(r["growth_per_min"], 1),
                        "threshold": r["threshold"]})
    if kind in ("semua", "senjata"):
        id_sql = " AND id = %s" if alert_id is not None else ""
        id_params = [alert_id] if alert_id is not None else []
        for r in db.all(f"""
                SELECT s.*, (SELECT note FROM weapon_alert_verification v
                              WHERE v.alert_id = s.id ORDER BY verified_at DESC, id DESC
                              LIMIT 1) AS note
                  FROM weapon_alert_status s
                 WHERE true{cam_sql}{where}{id_sql} ORDER BY ts DESC LIMIT %s""",
                        (*cam_params, *params, *id_params, limit)):
            out.append({"type": "senjata", "id": r["id"], "ts": r["ts"].isoformat(),
                        "camera": r["camera_id"], "confidence": round(r["confidence"], 3),
                        "snapshot": r["snapshot_path"], "model": r["model"],
                        "status": r["status"], "verifiedBy": r["verified_by"],
                        "verifiedAt": r["verified_at"].isoformat() if r["verified_at"] else None,
                        "secondsToVerify": round(float(r["seconds_to_verify"]))
                        if r["seconds_to_verify"] is not None else None,
                        "note": r["note"]})
    out.sort(key=lambda a: a["ts"], reverse=True)
    return out[:limit]


def _latest_alert_ids(db: Database) -> dict:
    row = db.one("SELECT (SELECT coalesce(max(id), 0) FROM crowd_alert) AS crowd, "
                 "(SELECT coalesce(max(id), 0) FROM weapon_alert) AS weapon")
    return {"crowd": row["crowd"], "weapon": row["weapon"]}


def _new_alerts(db: Database, last: dict) -> tuple[list[dict], dict]:
    current = _latest_alert_ids(db)
    fresh = []
    if current["crowd"] > last["crowd"]:
        fresh += [a for a in _alerts(db, None, "kerumunan", None, None, 50)
                  if a["id"] > last["crowd"]]
    if current["weapon"] > last["weapon"]:
        fresh += [a for a in _alerts(db, None, "senjata", None, None, 50)
                  if a["id"] > last["weapon"]]
    return fresh, current


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _wib(iso: str | None) -> str:
    if not iso:
        return ""
    return datetime.fromisoformat(iso).astimezone(WIB).strftime("%Y-%m-%d %H:%M:%S")


def _csv(text: str, filename: str) -> Response:
    # BOM: Excel otherwise reads UTF-8 as the local code page.
    return Response("﻿" + text, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
