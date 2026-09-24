"""The worker loop: frame -> detections -> tracks -> crowd / weapon / congestion -> store."""

from __future__ import annotations

import json
import logging
import os
import queue
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import overlay
from .analytics.congestion import ZoneMonitor
from .analytics.crowd import CrowdMonitor, split_riders
from .analytics.tracks import TrackBook
from .analytics.weapon import WeaponScreen
from .config import PERSON, Config
from .detect import Detector
from .ingest import Stream

log = logging.getLogger(__name__)

RETENTION_CHECK_SECONDS = 3600


def run(cfg: Config, store, show: bool = False, max_seconds: float | None = None) -> None:
    # The reader thread reports stream state; the store is only ever touched
    # from this thread, so the report is queued and drained here.
    states: queue.Queue = queue.Queue()
    stream = Stream(cfg.source, cfg.frame_stride,
                    on_state=lambda s, d: states.put((s, d))).start()
    try:
        _loop(cfg, store, stream, states, show, max_seconds)
    finally:
        stream.stop()
        if show:
            cv2.destroyAllWindows()


def _loop(cfg: Config, store, stream: Stream, states: queue.Queue, show: bool,
          max_seconds: float | None) -> None:
    started = time.monotonic()
    stream_up = False
    detector: Detector | None = None
    monitors: list[ZoneMonitor] = []
    book = TrackBook()
    crowd = CrowdMonitor(cfg.crowd) if cfg.crowd.enabled else None
    weapon = WeaponScreen(cfg.weapon)
    session = None
    next_live = next_retention = 0.0
    minute = None
    processed, fps, fps_window = 0, 0.0, time.monotonic()

    while max_seconds is None or time.monotonic() - started < max_seconds:
        while not states.empty():
            state, detail = states.get()
            stream_up = state == "up"
            store.stream_state(state, detail)

        frame = stream.read(timeout=5.0)
        if frame is None:
            continue

        if detector is None:
            w, h = stream.size
            log.info("frame %dx%d, stride %d, model %s @ %s, classes %s", w, h, cfg.frame_stride,
                     cfg.model, cfg.imgsz, cfg.detect_classes)
            detector = Detector(cfg.model, cfg.detect_classes, cfg.confidence, cfg.imgsz,
                                frame_rate=stream.fps / cfg.frame_stride)
            if cfg.traffic.enabled:
                monitors = [ZoneMonitor(z, z.pixels(w, h)) for z in cfg.traffic.zones]
                if not monitors:
                    log.warning("traffic on but no zones: draw them with `python -m fv_vision roi`")

        if frame.session != session:
            # A reconnect breaks media time and track identity alike.
            session = frame.session
            detector.reset()
            book.clear()
            weapon.clear()
            if crowd:
                crowd.reset()
            for m in monitors:
                m.reset()

        t, wall = frame.media_t, frame.wall_t
        detections, tracked = detector(frame.image)
        tracks = book.update(tracked, t)
        boxes, class_ids = detections.xyxy, detections.class_id
        walkers, riders = split_riders(boxes, class_ids, cfg.crowd.rider_vehicles)
        vehicles = boxes[class_ids != PERSON]

        # F1 / F2
        if crowd:
            for alert in crowd.observe(t, wall, len(walkers)):
                store.crowd_alert(wall, alert)

        # F3 needs one person over several frames, so it screens tracks.
        # Riders are screened too: a blade can be carried on a motorcycle.
        if weapon.active:
            people = [tr for tr in tracks if tr.class_id == PERSON]
            for hit in weapon.screen(frame.image, people):
                snap = overlay.weapon_snapshot(frame.image, boxes[class_ids == PERSON],
                                               hit.crop_box, hit.track.box, hit.confidence,
                                               blur=cfg.blur_faces)
                path = _save_snapshot(cfg, snap, "senjata", wall)
                store.weapon_alert(wall, hit.confidence, path, cfg.weapon.model or "")

        # Vehicle density per zone, by the bottom-centre of each box.
        if monitors:
            is_vehicle = np.isin(class_ids, cfg.traffic.vehicles)
            vboxes = boxes[is_vehicle]
            anchors = np.column_stack(((vboxes[:, 0] + vboxes[:, 2]) / 2, vboxes[:, 3]))
            vtracks = [tr for tr in tracks if tr.class_id in cfg.traffic.vehicles]
            taken = np.zeros(len(vboxes), dtype=bool)
            for m in monitors:
                mask = m.inside(anchors) & ~taken
                taken |= mask
                m.observe(t, vboxes[mask], [tr for tr in vtracks if m.contains(tr.anchor)])

        for tr in book.prune(t):
            weapon.forget(tr.id)

        # Output cadence, on the wall clock.
        now = time.time()
        if now >= next_live:
            next_live = now + cfg.status_interval_seconds
            if crowd:
                store.people_live({"updated_at": wall, "count": crowd.count,
                                   "growth_per_min": crowd.growth_per_min,
                                   "peak_count": crowd.peak_count, "peak_at": crowd.peak_wall})
            store.zone_live([
                {"zone_id": m.zone.id, "updated_at": wall, "status": m.status,
                 "status_since": wall - (t - m.status_since), "vehicle_count": m.last.count,
                 "occupancy": m.last.occupancy, "avg_speed_px": m.last.avg_speed_px}
                for m in monitors if m.status is not None and m.last is not None
            ])
        this_minute = int(now // 60)
        if minute is not None and this_minute != minute:
            if crowd and (row := crowd.drain_minute()):
                store.people_minute(now - 60, row)
            store.zone_minute(now - 60, [r for r in (m.drain_minute() for m in monitors) if r])
        minute = this_minute
        if now >= next_retention:
            next_retention = now + RETENTION_CHECK_SECONDS
            _prune_snapshots(cfg)

        processed += 1
        if time.monotonic() - fps_window >= 10:
            fps = processed / (time.monotonic() - fps_window)
            processed, fps_window = 0, time.monotonic()
            parts = [f"{fps:.1f} fps"]
            if crowd:
                parts.append(f"orang={crowd.count} (pengendara {len(riders)}) "
                             f"laju={crowd.growth_per_min:+.1f}/mnt")
            if weapon.active:
                parts.append(f"F3 crop layak={weapon.eligible_last}")
            parts += [f"{m.zone.id}={m.status}({m.last.count if m.last else 0})"
                      for m in monitors]
            log.info(" | ".join(parts))

        view = overlay.draw(frame.image, walkers=walkers, riders=riders, vehicles=vehicles,
                            monitors=monitors, crowd=crowd, fps=fps, stream_up=stream_up,
                            blur=cfg.blur_faces)
        _publish_live(cfg, view, {
            "camera_id": cfg.camera_id,
            "wall": wall,
            "fps": round(fps, 2),
            "stream_up": stream_up,
            "width": frame.image.shape[1],
            "height": frame.image.shape[0],
            "people": crowd.count if crowd else None,
            "riders": int(len(riders)),
            "growth_per_min": round(crowd.growth_per_min, 2) if crowd else None,
            "peak_count": crowd.peak_count if crowd else None,
            "peak_wall": crowd.peak_wall if crowd else None,
            "zones": [{"id": m.zone.id, "name": m.zone.name, "status": m.status,
                       "vehicles": m.last.count if m.last else 0,
                       "occupancy": round(m.last.occupancy, 3) if m.last else 0.0,
                       "status_since": wall - (t - m.status_since) if m.status else None}
                      for m in monitors],
            "weapon_active": weapon.active,
        })

        if show:
            cv2.imshow(f"fv-vision {cfg.camera_id}", view)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break


def _publish_live(cfg: Config, view, state: dict) -> None:
    """Newest annotated frame and live figures, replaced atomically.

    The dashboard is a separate process (it restarts without touching
    detection), so the handover is two files it only ever reads whole.
    """
    try:
        cfg.live_dir.mkdir(parents=True, exist_ok=True)
        ok, jpg = cv2.imencode(".jpg", view, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            _replace(cfg.live_dir / f"{cfg.camera_id}.jpg", jpg.tobytes())
        _replace(cfg.live_dir / f"{cfg.camera_id}.json", json.dumps(state).encode())
    except OSError as exc:
        log.debug("live publish failed: %s", exc)


def _replace(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _save_snapshot(cfg: Config, image, kind: str, wall: float) -> str | None:
    stamp = datetime.fromtimestamp(wall)
    rel = Path(stamp.strftime("%Y-%m-%d")) / f"{cfg.camera_id}_{kind}_{stamp:%H%M%S_%f}.jpg"
    path = cfg.snapshot_dir / rel
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return rel.as_posix()
    except Exception as exc:  # noqa: BLE001 - a lost snapshot must not lose the alert
        log.warning("snapshot failed: %s", exc)
        return None


def _prune_snapshots(cfg: Config) -> None:
    """PRD: snapshots are kept 30 days."""
    root = cfg.snapshot_dir
    if not root.is_dir():
        return
    cutoff = time.time() - cfg.snapshot_retention_days * 86400
    removed = 0
    for f in root.rglob("*.jpg"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
        except OSError:
            pass
    for d in sorted((d for d in root.iterdir() if d.is_dir()), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()
    if removed:
        log.info("retention: removed %d snapshots older than %d days", removed,
                 cfg.snapshot_retention_days)
