"""Track bookkeeping: position history and a stable class per track id."""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass, field

import numpy as np
import supervision as sv

# Seconds of position history kept per track: enough for the speed window and
# for drawing a short trail.
HISTORY_SECONDS = 10.0
# A track unseen for this long is considered gone.
TRACK_TTL_SECONDS = 5.0


@dataclass
class Track:
    id: int
    first_t: float
    last_t: float
    box: np.ndarray  # xyxy, pixels
    history: deque = field(default_factory=deque)  # (t, x, y) of the anchor
    class_votes: Counter = field(default_factory=Counter)
    zone_id: str | None = None

    @property
    def anchor(self) -> np.ndarray:
        """Bottom centre of the box: where the object meets the ground."""
        x1, _, x2, y2 = self.box
        return np.array([(x1 + x2) / 2.0, y2])

    @property
    def box_height(self) -> float:
        return float(self.box[3] - self.box[1])

    @property
    def box_area(self) -> float:
        x1, y1, x2, y2 = self.box
        return float(max(0.0, x2 - x1) * max(0.0, y2 - y1))

    @property
    def class_id(self) -> int:
        # Majority over the track's life: one frame calling a truck a car
        # must not change what it is counted as.
        return self.class_votes.most_common(1)[0][0]

    def previous_anchor(self) -> np.ndarray | None:
        if len(self.history) < 2:
            return None
        _, x, y = self.history[-2]
        return np.array([x, y])

    def speed_px(self, now: float, window: float = 2.0) -> float | None:
        """Mean anchor speed over the last `window` seconds, px/s."""
        if len(self.history) < 2:
            return None
        t1, x1, y1 = self.history[-1]
        for t0, x0, y0 in self.history:
            if t1 - t0 <= window:
                break
        dt = t1 - t0
        if dt < 0.4:
            return None
        return float(np.hypot(x1 - x0, y1 - y0) / dt)


class TrackBook:
    def __init__(self) -> None:
        self.tracks: dict[int, Track] = {}

    def update(self, detections: sv.Detections, t: float) -> list[Track]:
        seen: list[Track] = []
        if detections.tracker_id is None:
            return seen
        for box, class_id, track_id in zip(detections.xyxy, detections.class_id,
                                           detections.tracker_id):
            track_id = int(track_id)
            track = self.tracks.get(track_id)
            if track is None:
                track = Track(id=track_id, first_t=t, last_t=t, box=box)
                self.tracks[track_id] = track
            track.box = box
            track.last_t = t
            track.class_votes[int(class_id)] += 1
            x, y = track.anchor
            track.history.append((t, float(x), float(y)))
            while track.history and t - track.history[0][0] > HISTORY_SECONDS:
                track.history.popleft()
            seen.append(track)
        return seen

    def prune(self, t: float) -> list[Track]:
        gone = [tr for tr in self.tracks.values() if t - tr.last_t > TRACK_TTL_SECONDS]
        for tr in gone:
            del self.tracks[tr.id]
        return gone

    def clear(self) -> None:
        self.tracks.clear()
