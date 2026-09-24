"""F1: zone status (lancar / padat / macet) from occupancy and movement."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from ..config import Zone
from .tracks import Track

LANCAR, PADAT, MACET = "lancar", "padat", "macet"


@dataclass
class ZoneReading:
    count: int
    occupancy: float
    avg_speed_px: float | None
    raw_status: str


class ZoneMonitor:
    def __init__(self, zone: Zone, polygon_px: np.ndarray):
        self.zone = zone
        self.polygon = polygon_px
        self.area = max(1.0, float(cv2.contourArea(polygon_px)))
        self.status: str | None = None
        self.status_since = 0.0
        self._candidate: str | None = None
        self._candidate_since = 0.0
        self.last: ZoneReading | None = None
        self._minute: list[ZoneReading] = []

    def contains(self, point: np.ndarray) -> bool:
        return cv2.pointPolygonTest(self.polygon, (float(point[0]), float(point[1])), False) >= 0

    def inside(self, points: np.ndarray) -> np.ndarray:
        """Mask of the points (n, 2) that fall in the zone."""
        return np.array([self.contains(p) for p in points], dtype=bool)

    def observe(self, t: float, boxes: np.ndarray, tracks: list[Track]) -> ZoneReading:
        """boxes: every vehicle detection in the zone this frame; tracks: those tracked.

        Count and occupancy come from the boxes. Speed comes from the tracks,
        and only counts when most of the zone's vehicles are tracked: at a low
        analysed frame rate the tracks that survive are the slow ones, and a
        speed averaged over them alone would call free-flowing traffic padat.
        """
        th = self.zone.congestion
        count = len(boxes)
        areas = (boxes[:, 2] - boxes[:, 0]).clip(0) * (boxes[:, 3] - boxes[:, 1]).clip(0)
        occupancy = min(1.0, float(areas.sum()) / self.area) if count else 0.0
        speeds = [s for s in (tr.speed_px(t) for tr in tracks) if s is not None]
        speed = float(np.mean(speeds)) if speeds and len(speeds) * 2 >= count else None

        if count == 0:
            raw = LANCAR
        elif speed is not None and speed <= th.speed_macet_px and occupancy >= th.occupancy_padat:
            raw = MACET
        elif occupancy >= th.occupancy_macet:
            raw = MACET
        elif occupancy >= th.occupancy_padat or (speed is not None and speed <= th.speed_padat_px):
            raw = PADAT
        else:
            raw = LANCAR

        self._smooth(t, raw)
        reading = ZoneReading(count, occupancy, speed, raw)
        self.last = reading
        self._minute.append(reading)
        return reading

    def _smooth(self, t: float, raw: str) -> None:
        # The first reading sets the status at once, so a fresh start does not
        # show "lancar" for 30 s over a jammed road. After that a change must
        # hold for hold_seconds before it is believed.
        if self.status is None:
            self.status, self.status_since = raw, t
            return
        if raw == self.status:
            self._candidate = None
            return
        if raw != self._candidate:
            self._candidate, self._candidate_since = raw, t
        elif t - self._candidate_since >= self.zone.congestion.hold_seconds:
            self.status, self.status_since = raw, self._candidate_since
            self._candidate = None

    def reset(self) -> None:
        self.status = None
        self._candidate = None
        self.last = None

    def drain_minute(self) -> dict | None:
        """Average of the readings since the last drain, for zone_status."""
        readings, self._minute = self._minute, []
        if not readings or self.status is None:
            return None
        speeds = [r.avg_speed_px for r in readings if r.avg_speed_px is not None]
        return {
            "zone_id": self.zone.id,
            "status": self.status,
            "vehicle_count": float(np.mean([r.count for r in readings])),
            "occupancy": float(np.mean([r.occupancy for r in readings])),
            "avg_speed_px": float(np.mean(speeds)) if speeds else None,
        }
