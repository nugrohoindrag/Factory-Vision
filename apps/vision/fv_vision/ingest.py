"""Stream ingest: read an HLS (or file/RTSP) source and hand over the newest frame.

A reader thread decodes continuously and keeps only the latest sampled frame.
If the detector is slower than the stream, frames are dropped rather than
queued, so the analysis stays at the live edge instead of drifting minutes
behind it until the HLS segments expire.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np

log = logging.getLogger(__name__)


@dataclass
class Frame:
    image: np.ndarray
    # Media time in seconds, from the stream's timestamps. Monotonic within
    # one connection, which is what speeds and hold times are measured
    # against: HLS delivers whole segments in bursts, so wall-clock arrival
    # time would squeeze seconds of motion into milliseconds.
    media_t: float
    wall_t: float
    # Increments on every reconnect; trackers must reset when it changes.
    session: int


class Stream:
    def __init__(self, source: str, stride: int = 5, reconnect_delay: float = 5.0,
                 on_state=None):
        self.source = source
        self.stride = max(1, stride)
        self.reconnect_delay = reconnect_delay
        self.on_state = on_state or (lambda state, detail: None)
        self.fps = 0.0
        self.size: tuple[int, int] | None = None
        self._latest: Frame | None = None
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="stream-reader", daemon=True)
        self._is_file = not source.lower().startswith(("http://", "https://", "rtsp://"))

    def start(self) -> "Stream":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=5)

    def read(self, timeout: float = 30.0) -> Frame | None:
        """Block until a frame newer than the last one read is available."""
        with self._cond:
            if self._latest is None:
                self._cond.wait(timeout)
            frame, self._latest = self._latest, None
            return frame

    def _open(self) -> cv2.VideoCapture | None:
        cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            cap.release()
            return None
        self.fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        if not (1 <= self.fps <= 120):
            self.fps = 25.0
        return cap

    def _run(self) -> None:
        session = 0
        while not self._stop.is_set():
            cap = self._open()
            if cap is None:
                self.on_state("down", f"cannot open {self.source}")
                log.warning("stream: cannot open, retrying in %.0fs", self.reconnect_delay)
                self._stop.wait(self.reconnect_delay)
                continue

            session += 1
            index = 0
            self.on_state("up", f"fps={self.fps:.1f}")
            log.info("stream: connected (session %d, %.1f fps)", session, self.fps)
            # Frames are released at the pace of their own timestamps. A file
            # would otherwise be read as fast as it decodes, and a live HLS
            # stream arrives a whole segment at a time: decoded in a burst,
            # most of it would be overwritten before the detector saw it.
            pace_start: float | None = None
            media_start = 0.0

            while not self._stop.is_set():
                if not cap.grab():
                    break
                index += 1
                if index % self.stride:
                    continue
                ok, image = cap.retrieve()
                if not ok:
                    break
                # The container's own timestamp where there is one: a stream
                # whose declared fps is not what it delivers would otherwise
                # stretch every speed and dwell time.
                pos = cap.get(cv2.CAP_PROP_POS_MSEC)
                media_t = pos / 1000.0 if pos > 0 else index / self.fps
                if pace_start is None:
                    pace_start, media_start = time.monotonic(), media_t
                ahead = (media_t - media_start) - (time.monotonic() - pace_start)
                if ahead > 0:
                    if ahead > 30:
                        # A timestamp jump (stream restarted upstream): re-anchor.
                        pace_start, media_start = time.monotonic(), media_t
                    else:
                        time.sleep(ahead)
                if self.size is None:
                    self.size = (image.shape[1], image.shape[0])
                with self._cond:
                    self._latest = Frame(image, media_t, time.time(), session)
                    self._cond.notify_all()

            cap.release()
            if self._stop.is_set():
                break
            if self._is_file:
                log.info("stream: end of file, looping")
                continue
            self.on_state("down", "stream ended or read failed")
            log.warning("stream: lost, reconnecting in %.0fs", self.reconnect_delay)
            self._stop.wait(self.reconnect_delay)
