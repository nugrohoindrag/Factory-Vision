"""fv-vision command line.

    python -m fv_vision run     [--config config/c11.yaml] [--show] [--seconds N]
    python -m fv_vision roi     [--config ...] [--image frame.jpg]
    python -m fv_vision probe   [--config ...]
    python -m fv_vision bench   [--config ...] [MODEL ...]
    python -m fv_vision pending [--config ...]
    python -m fv_vision verify  ID konfirmasi|tolak --by NAME [--note TEXT]
    python -m fv_vision serve   [--host 0.0.0.0] [--port 8000]
    python -m fv_vision user    add USERNAME --name NAME [--role operator|admin]
    python -m fv_vision user    disable|enable USERNAME

pending / verify are F4 from the terminal until the dashboard carries the
Konfirmasi / Tolak buttons; they need VISION_DATABASE_URL.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

from . import config as config_mod


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fv_vision")
    sub = parser.add_subparsers(dest="cmd", required=True)
    default_cfg = os.environ.get("VISION_CONFIG", "config/c11.yaml")

    p = sub.add_parser("run", help="run the analytics worker")
    p.add_argument("--config", default=default_cfg)
    p.add_argument("--show", action="store_true", help="open a window with the overlay")
    p.add_argument("--seconds", type=float, help="stop after N seconds")

    p = sub.add_parser("roi", help="draw road zones over a frame")
    p.add_argument("--config", default=default_cfg)
    p.add_argument("--image", help="use this image instead of a live frame")

    p = sub.add_parser("probe", help="report the stream's resolution and frame rate")
    p.add_argument("--config", default=default_cfg)
    p.add_argument("--seconds", type=float, default=10)

    p = sub.add_parser("bench", help="time the detector on frames from the camera")
    p.add_argument("--config", default=default_cfg)
    p.add_argument("models", nargs="*", help="model paths to compare (default: the config's)")

    p = sub.add_parser("pending", help="list weapon alerts waiting for an operator")
    p.add_argument("--config", default=default_cfg)

    p = sub.add_parser("verify", help="record an operator decision on a weapon alert")
    p.add_argument("alert_id", type=int)
    p.add_argument("decision", choices=["konfirmasi", "tolak"])
    p.add_argument("--by", required=True, help="who verified")
    p.add_argument("--note")

    p = sub.add_parser("serve", help="run the dashboard (needs VISION_DATABASE_URL)")
    p.add_argument("--host", default=os.environ.get("VISION_HOST", "0.0.0.0"))
    p.add_argument("--port", type=int, default=int(os.environ.get("VISION_PORT", "8000")))

    p = sub.add_parser("user", help="manage dashboard accounts")
    p.add_argument("action", choices=["add", "disable", "enable"])
    p.add_argument("username")
    p.add_argument("--name", help="display name (add)")
    p.add_argument("--role", choices=["operator", "admin"], default="operator")

    args = parser.parse_args(argv)
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    url = os.environ.get("VISION_DATABASE_URL")

    if args.cmd == "verify":
        from . import store

        if not url:
            print("VISION_DATABASE_URL is not set")
            return 2
        store.verify(url, args.alert_id, args.decision, args.by, args.note)
        print(f"alert #{args.alert_id}: {args.decision} oleh {args.by}")
        return 0

    if args.cmd == "serve":
        import uvicorn

        from .web.app import create_app

        # Behind Traefik: trust its X-Forwarded-* so client addresses in the
        # audit log and login throttle are the real ones.
        uvicorn.run(create_app(), host=args.host, port=args.port, proxy_headers=True,
                    forwarded_allow_ips="*", log_level="info")
        return 0

    if args.cmd == "user":
        return _user(args, url)

    cfg = config_mod.load(args.config)

    if args.cmd == "run":
        from . import pipeline, store

        sink = store.PgStore(url, cfg.camera_id) if url else store.LogStore(cfg.camera_id)
        try:
            pipeline.run(cfg, sink, show=args.show, max_seconds=args.seconds)
        except KeyboardInterrupt:
            pass
        return 0

    if args.cmd == "roi":
        from . import roi_tool

        roi_tool.run(cfg, args.image)
        return 0

    if args.cmd == "pending":
        from . import store

        if not url:
            print("VISION_DATABASE_URL is not set")
            return 2
        rows = store.pending(url, cfg.camera_id)
        for alert_id, ts, camera, conf, snap, _ in rows:
            print(f"#{alert_id}  {ts:%Y-%m-%d %H:%M:%S}  {camera}  conf {conf:.2f}  {snap}")
        print(f"{len(rows)} alert menunggu verifikasi")
        return 0

    if args.cmd == "probe":
        return _probe(cfg.source, args.seconds)
    if args.cmd == "bench":
        return _bench(cfg, args.models or [cfg.model])
    return 1


def _bench(cfg, models: list[str]) -> int:
    """Which model format is faster depends on the CPU: measure, do not assume."""
    from ultralytics import YOLO

    from .roi_tool import grab_frame

    frame = grab_frame(cfg.source)
    for name in models:
        model = YOLO(name, task="detect")
        model.predict(frame, imgsz=cfg.imgsz, verbose=False)  # warm-up
        n, started = 10, time.perf_counter()
        for _ in range(n):
            result = model.predict(frame, imgsz=cfg.imgsz, conf=cfg.confidence,
                                   classes=cfg.detect_classes, verbose=False)[0]
        ms = (time.perf_counter() - started) / n * 1000
        print(f"{name:40s} {ms:6.0f} ms/frame  {1000 / ms:5.1f} fps  {len(result.boxes)} boxes")
    return 0


def _user(args, url: str | None) -> int:
    import getpass

    import psycopg

    from .web.auth import MIN_PASSWORD, hash_password
    from .web.db import Database

    if not url:
        print("VISION_DATABASE_URL is not set")
        return 2
    db = Database(url)
    db.ensure_schema()
    username = args.username.strip().lower()
    if args.action == "add":
        # From the environment for scripts, otherwise asked for twice.
        password = os.environ.get("VISION_NEW_PASSWORD") or getpass.getpass("kata sandi: ")
        if not os.environ.get("VISION_NEW_PASSWORD") and password != getpass.getpass("ulangi: "):
            print("kata sandi tidak sama")
            return 1
        if len(password) < MIN_PASSWORD:
            print(f"kata sandi minimal {MIN_PASSWORD} karakter")
            return 1
        try:
            db.execute("INSERT INTO dashboard_user (username, display_name, role, password_hash) "
                       "VALUES (%s, %s, %s, %s)",
                       (username, args.name or username, args.role, hash_password(password)))
        except psycopg.errors.UniqueViolation:
            print(f"{username} sudah ada")
            return 1
        print(f"akun {username} ({args.role}) dibuat")
    else:
        db.execute("UPDATE dashboard_user SET disabled = %s WHERE username = %s",
                   (args.action == "disable", username))
        print(f"akun {username}: {'dinonaktifkan' if args.action == 'disable' else 'diaktifkan'}")
    return 0


def _probe(source: str, seconds: float) -> int:
    import cv2

    cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        print(f"cannot open {source}")
        return 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames, started = 0, time.monotonic()
    while time.monotonic() - started < seconds:
        if not cap.read()[0]:
            break
        frames += 1
    elapsed = time.monotonic() - started
    cap.release()
    print(f"source      {source}")
    print(f"resolution  {width}x{height}")
    print(f"stream fps  {fps:.2f} (declared)")
    print(f"decoded     {frames} frames in {elapsed:.1f}s = {frames / elapsed:.1f} fps")
    return 0 if frames else 1


if __name__ == "__main__":
    sys.exit(main())
