"""Camera configuration: source, model, and one section per analytic.

Each camera is one YAML file (config/<camera>.yaml). An analytic whose
section is absent or `enabled: false` does not run.

Zone polygons are normalised (0..1 of the frame width and height), so a
config survives the stream changing resolution; they are converted to pixels
once the first frame tells us the size.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

# COCO class ids of the base detector.
PERSON, BICYCLE, CAR, MOTORCYCLE, BUS, TRUCK = 0, 1, 2, 3, 5, 7
COCO_NAMES = {PERSON: "orang", BICYCLE: "sepeda", CAR: "mobil", MOTORCYCLE: "motor",
              BUS: "bus", TRUCK: "truk"}
_BY_NAME = {"person": PERSON, "bicycle": BICYCLE, "car": CAR, "motorcycle": MOTORCYCLE,
            "bus": BUS, "truck": TRUCK}


@dataclass
class CrowdConfig:
    enabled: bool = True
    # A person whose bottom-centre falls inside one of these boxes is a rider.
    rider_vehicles: list[int] = field(default_factory=lambda: [MOTORCYCLE])
    # The live count is the median of this many analysed frames.
    median_window: int = 10
    # Alert when the count stays at or above alert_count for alert_hold_seconds,
    # or grows by at least alert_growth_per_min within a minute. Per camera,
    # because every camera sees a different area.
    alert_count: int = 30
    alert_hold_seconds: float = 60.0
    alert_growth_per_min: float = 15.0
    # After a growth alert, wait this long before the next one.
    alert_cooldown_seconds: float = 600.0


@dataclass
class CongestionThresholds:
    # Share of the zone covered by vehicle boxes.
    occupancy_padat: float = 0.25
    occupancy_macet: float = 0.45
    # Mean anchor movement, px/s. Perspective biases it per zone, which is
    # why every zone may override it.
    speed_padat_px: float = 40.0
    speed_macet_px: float = 12.0
    # A new status must hold this long before it replaces the current one.
    hold_seconds: float = 30.0


@dataclass
class Zone:
    id: str
    name: str
    polygon: np.ndarray  # normalised, shape (n, 2)
    congestion: CongestionThresholds

    def pixels(self, width: int, height: int) -> np.ndarray:
        return (self.polygon * [width, height]).astype(np.int32)


@dataclass
class TrafficConfig:
    enabled: bool = False
    vehicles: list[int] = field(default_factory=lambda: [CAR, MOTORCYCLE, BUS, TRUCK])
    zones: list[Zone] = field(default_factory=list)


@dataclass
class WeaponConfig:
    # Experimental (PRD F3): off until a fine-tuned model exists, and off on
    # any camera where it cannot meet the false-alert target.
    enabled: bool = False
    model: str | None = None
    # Class names of the fine-tuned model that count as a sharp weapon.
    classes: list[str] = field(default_factory=list)
    confidence: float = 0.5
    # Only people at least this tall are cropped: below it a blade is a few
    # pixels, which no model can tell from a stick or an umbrella.
    min_person_height_px: int = 150
    # Alert only when the object is seen in >= hits of the last `window`
    # screenings of the same person.
    hits: int = 3
    window: int = 5
    # Crops screened per analysed frame, largest people first (CPU budget).
    max_crops_per_frame: int = 4


@dataclass
class Config:
    camera_id: str
    source: str
    frame_stride: int
    model: str
    # An int, or [height, width]: an OpenVINO export has a fixed input
    # shape, and the predict size must match the one it was exported at.
    imgsz: int | list[int]
    confidence: float
    crowd: CrowdConfig
    traffic: TrafficConfig
    weapon: WeaponConfig
    # Pixelate heads in the live view and in snapshots. Off by default: the
    # system identifies nobody, and the product owner chose plain frames
    # (2026-09-24). privacy.py stays for a deployment that needs it.
    blur_faces: bool
    status_interval_seconds: float
    snapshot_dir: Path
    snapshot_retention_days: int
    # Newest annotated frame and live figures, for the dashboard.
    live_dir: Path
    path: Path = Path(".")

    @property
    def detect_classes(self) -> list[int]:
        """Everything the base detector must find for the enabled analytics."""
        classes: set[int] = set()
        if self.crowd.enabled or self.weapon.enabled:
            classes |= {PERSON, *self.crowd.rider_vehicles}
        if self.traffic.enabled:
            classes |= set(self.traffic.vehicles)
        return sorted(classes)


def _classes(names: list[str] | None, default: list[int]) -> list[int]:
    if names is None:
        return default
    unknown = [n for n in names if n not in _BY_NAME]
    if unknown:
        raise ValueError(f"unknown class names {unknown}; use {sorted(_BY_NAME)}")
    return [_BY_NAME[n] for n in names]


def _imgsz(value) -> int | list[int]:
    if isinstance(value, (list, tuple)):
        if len(value) != 2:
            raise ValueError("imgsz is an int or [height, width]")
        return [int(v) for v in value]
    return int(value)


def _congestion(raw: dict | None, base: CongestionThresholds) -> CongestionThresholds:
    return CongestionThresholds(**{**base.__dict__, **(raw or {})})


def load(path: str | os.PathLike) -> Config:
    path = Path(path)
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    c = dict(raw.get("crowd") or {"enabled": False})
    crowd = CrowdConfig(**{**c, "rider_vehicles": _classes(c.get("rider_vehicles"),
                                                           [MOTORCYCLE])})

    t = dict(raw.get("traffic") or {"enabled": False})
    base = _congestion(t.get("congestion"), CongestionThresholds())
    zones = [
        Zone(id=str(z["id"]), name=str(z.get("name", z["id"])),
             polygon=np.array(z["polygon"], dtype=np.float64),
             congestion=_congestion(z.get("congestion"), base))
        for z in t.get("zones", [])
    ]
    for z in zones:
        if len(z.polygon) < 3 or z.polygon.min() < 0 or z.polygon.max() > 1:
            raise ValueError(f"zone {z.id}: polygon needs >= 3 points in 0..1")
    traffic = TrafficConfig(
        enabled=bool(t.get("enabled", True)),
        vehicles=_classes(t.get("vehicles"), TrafficConfig().vehicles),
        zones=zones,
    )

    weapon = WeaponConfig(**(raw.get("weapon") or {}))
    weapon.model = os.environ.get("VISION_WEAPON_MODEL") or weapon.model

    return Config(
        camera_id=str(raw["camera_id"]),
        # The environment wins, so a recorded sample can stand in for the live
        # stream (offline demo mode) without editing the config.
        source=os.environ.get("VISION_SOURCE") or str(raw["source"]),
        frame_stride=int(raw.get("frame_stride", 5)),
        model=os.environ.get("VISION_MODEL") or raw.get("model", "yolo11s.pt"),
        imgsz=_imgsz(raw.get("imgsz", 960)),
        confidence=float(raw.get("confidence", 0.3)),
        crowd=crowd,
        traffic=traffic,
        weapon=weapon,
        blur_faces=bool(raw.get("blur_faces", False)),
        status_interval_seconds=float(raw.get("status_interval_seconds", 5)),
        snapshot_dir=Path(os.environ.get("VISION_SNAPSHOT_DIR")
                          or raw.get("snapshot_dir", "var/vision/snapshots")),
        snapshot_retention_days=int(raw.get("snapshot_retention_days", 30)),
        live_dir=Path(os.environ.get("VISION_LIVE_DIR") or raw.get("live_dir", "var/vision/live")),
        path=path,
    )
