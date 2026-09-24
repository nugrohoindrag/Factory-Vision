"""Base detection (YOLO, COCO classes) and tracking (ByteTrack).

Track ids live only in memory, for the length of a connection: they let the
congestion speed and the weapon persistence rule follow one object across
frames, and are never written anywhere.
"""

from __future__ import annotations

import numpy as np
import supervision as sv
from ultralytics import YOLO


class Detector:
    def __init__(self, model: str, classes: list[int], confidence: float, imgsz: int,
                 frame_rate: float):
        self.model = YOLO(model, task="detect")
        self.classes = classes
        self.confidence = confidence
        self.imgsz = imgsz
        self.frame_rate = frame_rate
        self.tracker = self._new_tracker()

    def _new_tracker(self) -> sv.ByteTrack:
        # frame_rate is the *analysed* rate: ByteTrack sizes its lost-track
        # buffer in frames, so it has to know.
        return sv.ByteTrack(frame_rate=max(1, round(self.frame_rate)))

    def reset(self) -> None:
        """Forget every track, after a reconnect."""
        self.tracker = self._new_tracker()

    def __call__(self, image: np.ndarray) -> tuple[sv.Detections, sv.Detections]:
        """(every detection, the tracked subset).

        Counts must come from the first. ByteTrack only reports a new track
        once it has matched it in a second frame, and at the 1-2 analysed
        frames per second a CPU manages, a vehicle has moved too far for that
        match: counting tracks would miss most of the traffic. Tracks are for
        what needs identity over time — speed and F3 persistence.
        """
        result = self.model.predict(image, conf=self.confidence, imgsz=self.imgsz,
                                    classes=self.classes or None, verbose=False)[0]
        detections = sv.Detections.from_ultralytics(result)
        return detections, self.tracker.update_with_detections(detections)
