"""F3: potential sharp weapon, second stage on person crops.

Experimental by design. Only people tall enough in the frame are cropped, the
crop goes through a fine-tuned model, and an alert needs the object in >= 3
of the last 5 screenings of the same person. Every alert is only ever a
*potential* weapon and waits for an operator (F4); nothing acts on it.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass

import numpy as np

from ..config import WeaponConfig
from .tracks import Track

log = logging.getLogger(__name__)

# Context around the person box: a blade held at arm's length sits outside it.
CROP_MARGIN = 0.25


@dataclass
class WeaponHit:
    track: Track
    confidence: float
    crop_box: tuple[int, int, int, int]


def crop_box(box: np.ndarray, width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (float(v) for v in box)
    mx, my = CROP_MARGIN * (x2 - x1), 0.1 * (y2 - y1)
    return (int(max(0, x1 - mx)), int(max(0, y1 - my)),
            int(min(width, x2 + mx)), int(min(height, y2 + my)))


class WeaponScreen:
    def __init__(self, cfg: WeaponConfig):
        self.cfg = cfg
        self.model = None
        self._class_ids: list[int] = []
        self._seen: dict[int, deque[float]] = {}
        self._alerted: set[int] = set()
        self.eligible_last = 0
        if not cfg.enabled:
            return
        if not cfg.model:
            log.warning("F3 disabled: weapon.enabled is set but no weapon.model is configured")
            return
        try:
            from ultralytics import YOLO

            self.model = YOLO(cfg.model, task="detect")
        except Exception as exc:  # noqa: BLE001 - a missing model disables F3, not the worker
            log.error("F3 disabled: cannot load %s (%s)", cfg.model, exc)
            return
        names = self.model.names
        self._class_ids = [i for i, n in names.items() if n in cfg.classes] if cfg.classes \
            else list(names)
        log.info("F3 on: %s, classes %s", cfg.model, [names[i] for i in self._class_ids])

    @property
    def active(self) -> bool:
        return self.model is not None

    def screen(self, image: np.ndarray, people: list[Track]) -> list[WeaponHit]:
        if not self.active:
            return []
        h, w = image.shape[:2]
        eligible = sorted((p for p in people if p.box_height >= self.cfg.min_person_height_px),
                          key=lambda p: p.box_height, reverse=True)
        self.eligible_last = len(eligible)
        hits = []
        for person in eligible[: self.cfg.max_crops_per_frame]:
            box = crop_box(person.box, w, h)
            crop = image[box[1]:box[3], box[0]:box[2]]
            result = self.model.predict(crop, conf=self.cfg.confidence,
                                        classes=self._class_ids, verbose=False)[0]
            conf = float(result.boxes.conf.max()) if len(result.boxes) else 0.0

            window = self._seen.setdefault(person.id, deque(maxlen=self.cfg.window))
            window.append(conf)
            hit_count = sum(1 for c in window if c >= self.cfg.confidence)
            if hit_count >= self.cfg.hits and person.id not in self._alerted:
                # One alert per person while they are tracked.
                self._alerted.add(person.id)
                hits.append(WeaponHit(person, max(window), box))
        return hits

    def forget(self, track_id: int) -> None:
        self._seen.pop(track_id, None)
        self._alerted.discard(track_id)

    def clear(self) -> None:
        self._seen.clear()
        self._alerted.clear()
