"""Draw the road zones used for vehicle density, over a frame from the camera.

    python -m fv_vision roi --config config/c11.yaml

  left click   add a point
  z            close the points as a zone (>= 3 points), name it in the terminal
  u            undo the last point
  s            write the YAML (normalised coordinates) and print it
  q / Esc      quit

People counting needs no zone: it counts the whole frame. The output goes to
var/vision/<camera>.roi.yaml; paste it under `traffic:` in the camera config.
With `blur_faces` on, the frame shown and saved has every head pixelated,
like everything else the worker writes.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import yaml

from .config import PERSON, Config
from .privacy import blur_heads

OUT_DIR = Path("var/vision")


def grab_frame(source: str, skip: int = 10) -> np.ndarray:
    cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {source}")
    frame = None
    # Skip the first frames: a stream often opens on a grey or half-decoded
    # frame before the first keyframe.
    for _ in range(skip):
        ok, img = cap.read()
        if ok:
            frame = img
    cap.release()
    if frame is None:
        raise SystemExit("no frame read from the source")
    return frame


def _blurred(cfg: Config, frame: np.ndarray) -> np.ndarray:
    if not cfg.blur_faces:
        return frame
    from ultralytics import YOLO

    result = YOLO(cfg.model).predict(frame, imgsz=cfg.imgsz, classes=[PERSON],
                                     conf=0.2, verbose=False)[0]
    return blur_heads(frame, result.boxes.xyxy.numpy())


def run(cfg: Config, image_path: str | None = None) -> None:
    frame = cv2.imread(image_path) if image_path else grab_frame(cfg.source)
    frame = _blurred(cfg, frame)
    h, w = frame.shape[:2]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT_DIR / f"{cfg.camera_id}.reference.jpg"), frame)

    zones = [{"id": z.id, "name": z.name, "polygon": z.polygon.tolist()}
             for z in cfg.traffic.zones]
    points: list[tuple[int, int]] = []
    window = f"ROI {cfg.camera_id} ({w}x{h})"

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            points.append((x, y))

    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(window, on_mouse)

    def px(p):
        return int(p[0] * w), int(p[1] * h)

    while True:
        view = frame.copy()
        for z in zones:
            poly = np.array([px(p) for p in z["polygon"]], dtype=np.int32)
            cv2.polylines(view, [poly], True, (80, 175, 76), 2)
            cv2.putText(view, z["id"], tuple(int(v) for v in poly[0]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (80, 175, 76), 1)
        for i, p in enumerate(points):
            cv2.circle(view, p, 3, (0, 180, 255), -1)
            if i:
                cv2.line(view, points[i - 1], p, (0, 180, 255), 1)
        cv2.putText(view, "klik=titik  z=zona  u=undo  s=simpan  q=keluar", (8, h - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.imshow(window, view)
        key = cv2.waitKey(30) & 0xFF

        if key in (ord("q"), 27):
            break
        if key == ord("u") and points:
            points.pop()
        elif key == ord("z"):
            if len(points) < 3:
                print("zona butuh minimal 3 titik")
                continue
            zid = input("id zona (mis. gatsu-arah-semanggi): ").strip() or f"zona-{len(zones) + 1}"
            name = input("nama tampilan: ").strip() or zid
            zones = [z for z in zones if z["id"] != zid]
            zones.append({"id": zid, "name": name,
                          "polygon": [[round(x / w, 4), round(y / h, 4)] for x, y in points]})
            points.clear()
        elif key == ord("s"):
            out = OUT_DIR / f"{cfg.camera_id}.roi.yaml"
            text = yaml.safe_dump({"zones": zones}, sort_keys=False, allow_unicode=True,
                                  default_flow_style=None)
            out.write_text(text, encoding="utf-8")
            print(f"\n# ditulis ke {out} — tempel di bawah `traffic:`\n{text}")

    cv2.destroyAllWindows()
