"""Face blurring for everything the worker shows or stores.

There is no face detector: at CCTV distances a face is a handful of pixels
and a detector misses most of them. Instead the head region of every person
box — its top fifth, widened a little — is pixelated. That over-blurs rather
than under-blurs, which is the side to err on (PRD: no unblurred face is ever
stored).
"""

from __future__ import annotations

import cv2
import numpy as np

HEAD_FRACTION = 0.22
WIDEN = 0.15


def head_region(box: np.ndarray, width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (float(v) for v in box)
    bw, bh = x2 - x1, y2 - y1
    hx1 = int(max(0, x1 - WIDEN * bw))
    hx2 = int(min(width, x2 + WIDEN * bw))
    hy1 = int(max(0, y1 - 0.05 * bh))
    hy2 = int(min(height, y1 + HEAD_FRACTION * bh))
    return hx1, hy1, hx2, hy2


def blur_heads(image: np.ndarray, person_boxes) -> np.ndarray:
    """Return a copy of image with every person's head region pixelated."""
    out = image.copy()
    h, w = out.shape[:2]
    for box in person_boxes:
        x1, y1, x2, y2 = head_region(box, w, h)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        roi = out[y1:y2, x1:x2]
        # Pixelate to ~4 blocks across: unrecognisable at any size.
        small = cv2.resize(roi, (4, max(1, round(4 * roi.shape[0] / roi.shape[1]))),
                           interpolation=cv2.INTER_LINEAR)
        out[y1:y2, x1:x2] = cv2.resize(small, (roi.shape[1], roi.shape[0]),
                                       interpolation=cv2.INTER_NEAREST)
    return out
