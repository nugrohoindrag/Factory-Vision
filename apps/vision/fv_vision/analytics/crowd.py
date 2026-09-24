"""F1 people counting and F2 crowd alerts.

Every person in the frame is counted — no zone — except riders: a person
whose bottom-centre falls inside a motorcycle box is on it, not on the
pavement. The live figure is a median over the last frames, so one frame
that misses half the crowd does not make the number jump.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from ..config import PERSON, CrowdConfig


def split_riders(boxes: np.ndarray, class_ids: np.ndarray,
                 rider_vehicles: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """(pedestrian boxes, rider boxes) among the person detections of one frame."""
    vehicles = boxes[np.isin(class_ids, rider_vehicles)]
    people = boxes[class_ids == PERSON]
    if len(people) == 0 or len(vehicles) == 0:
        return people, people[:0]
    # Bottom-centre of each person against every vehicle box.
    x = ((people[:, 0] + people[:, 2]) / 2)[:, None]
    y = people[:, 3][:, None]
    on = ((x >= vehicles[:, 0]) & (x <= vehicles[:, 2]) &
          (y >= vehicles[:, 1]) & (y <= vehicles[:, 3])).any(axis=1)
    return people[~on], people[on]


@dataclass
class CrowdAlert:
    kind: str  # "jumlah" | "laju"
    count: int
    growth_per_min: float
    threshold: float


class CrowdMonitor:
    def __init__(self, cfg: CrowdConfig):
        self.cfg = cfg
        self._recent: deque[int] = deque(maxlen=max(1, cfg.median_window))
        self._history: deque[tuple[float, int]] = deque()  # (t, count), last ~2 min
        self._minute: list[int] = []
        self.count = 0
        self.growth_per_min = 0.0
        self.peak_count = 0
        self.peak_wall: float | None = None
        self._peak_day: str | None = None
        self._above_since: float | None = None
        self._count_alerted = False
        self._growth_alerted_at: float | None = None

    def observe(self, t: float, wall: float, raw_count: int) -> list[CrowdAlert]:
        self._recent.append(raw_count)
        self.count = int(round(float(np.median(self._recent))))
        self._minute.append(self.count)

        self._history.append((t, self.count))
        while self._history and t - self._history[0][0] > 120:
            self._history.popleft()
        # Growth over the last minute: now against the oldest count at least
        # 60 s old, once there is a minute of history to compare with.
        old = next(((ht, hc) for ht, hc in reversed(self._history) if t - ht >= 60), None)
        self.growth_per_min = float(self.count - old[1]) * 60.0 / (t - old[0]) if old else 0.0

        day = datetime.fromtimestamp(wall).strftime("%Y-%m-%d")
        if day != self._peak_day:
            self._peak_day, self.peak_count, self.peak_wall = day, 0, None
        if self.count > self.peak_count:
            self.peak_count, self.peak_wall = self.count, wall

        return self._alerts(t)

    def _alerts(self, t: float) -> list[CrowdAlert]:
        cfg, alerts = self.cfg, []
        if self.count >= cfg.alert_count:
            if self._above_since is None:
                self._above_since = t
            if not self._count_alerted and t - self._above_since >= cfg.alert_hold_seconds:
                self._count_alerted = True
                alerts.append(CrowdAlert("jumlah", self.count, self.growth_per_min,
                                         cfg.alert_count))
        else:
            # Re-arm only once the crowd has dropped back below the threshold.
            self._above_since, self._count_alerted = None, False

        if self.growth_per_min >= cfg.alert_growth_per_min and (
                self._growth_alerted_at is None
                or t - self._growth_alerted_at >= cfg.alert_cooldown_seconds):
            self._growth_alerted_at = t
            alerts.append(CrowdAlert("laju", self.count, self.growth_per_min,
                                     cfg.alert_growth_per_min))
        return alerts

    def reset(self) -> None:
        """After a reconnect: the time base changed, keep only the peak."""
        self._recent.clear()
        self._history.clear()
        self._above_since = None

    def drain_minute(self) -> dict | None:
        counts, self._minute = self._minute, []
        if not counts:
            return None
        return {"avg_count": float(np.mean(counts)), "min_count": int(min(counts)),
                "max_count": int(max(counts))}
