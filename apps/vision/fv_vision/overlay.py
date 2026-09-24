"""Drawing for the live view and snapshots (heads pixelated first when blur is on)."""

from __future__ import annotations

import cv2
import numpy as np

from .privacy import blur_heads

# BGR. Green / amber / red for lancar / padat / macet, grey before a status.
STATUS_COLOURS = {"lancar": (80, 175, 76), "padat": (0, 180, 255), "macet": (54, 67, 244)}
NEUTRAL = (160, 160, 160)
PERSON_COLOUR = (235, 180, 40)
RIDER_COLOUR = (120, 120, 120)
VEHICLE_COLOUR = (200, 200, 200)
ALERT_COLOUR = (54, 67, 244)


def draw(image: np.ndarray, *, walkers=(), riders=(), vehicles=(), monitors=(), crowd=None,
         fps: float | None = None, stream_up: bool = True, blur: bool = False) -> np.ndarray:
    """walkers / riders / vehicles are box arrays (xyxy) of this frame's detections."""
    people = [*walkers, *riders]
    out = blur_heads(image, people) if blur else image.copy()

    if monitors:
        shade = out.copy()
        for m in monitors:
            cv2.fillPoly(shade, [m.polygon], STATUS_COLOURS.get(m.status, NEUTRAL))
        out = cv2.addWeighted(shade, 0.15, out, 0.85, 0)
        for m in monitors:
            colour = STATUS_COLOURS.get(m.status, NEUTRAL)
            cv2.polylines(out, [m.polygon], True, colour, 2)
            x, y = m.polygon.min(axis=0)
            label = f"{m.zone.name}: {m.status or '-'}"
            if m.last is not None:
                label += f" ({m.last.count} kend.)"
            _label(out, label, (int(x), int(y) - 6), colour)

    for box in vehicles:
        _box(out, box, VEHICLE_COLOUR, 1)
    for box in riders:
        _box(out, box, RIDER_COLOUR, 1)
    for box in walkers:
        _box(out, box, PERSON_COLOUR, 2)

    if crowd is not None:
        _label(out, f"Orang: {crowd.count}  (laju {crowd.growth_per_min:+.0f}/mnt, "
                    f"puncak {crowd.peak_count})", (8, 22), (255, 255, 255), scale=0.6)

    h = out.shape[0]
    status = (f"{fps:.1f} FPS  " if fps else "") + ("stream OK" if stream_up else "stream PUTUS")
    _label(out, status, (8, h - 10), (255, 255, 255))
    return out


def weapon_snapshot(image: np.ndarray, person_boxes, crop_box, person_box,
                    confidence: float, blur: bool = False) -> np.ndarray:
    """The crop an operator verifies, labelled as a potential only."""
    source = blur_heads(image, person_boxes) if blur else image
    x1, y1, x2, y2 = crop_box
    crop = source[y1:y2, x1:x2].copy()
    px1, py1, px2, py2 = (int(v) for v in person_box)
    cv2.rectangle(crop, (px1 - x1, py1 - y1), (px2 - x1, py2 - y1), ALERT_COLOUR, 2)
    _label(crop, f"POTENSI senjata tajam {confidence:.2f}", (4, 16), ALERT_COLOUR, scale=0.45)
    return crop


def _box(img, box, colour, thickness):
    x1, y1, x2, y2 = (int(v) for v in box)
    cv2.rectangle(img, (x1, y1), (x2, y2), colour, thickness)


def _label(img, text, org, colour, scale=0.5):
    x, y = int(org[0]), max(14, int(org[1]))
    (w, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    cv2.rectangle(img, (x - 2, y - th - 4), (x + w + 2, y + 4), (0, 0, 0), -1)
    cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, colour, 1, cv2.LINE_AA)
