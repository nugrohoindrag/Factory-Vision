"""Crowd (F1/F2), weapon persistence (F3), blur, congestion — no model, no stream."""

from types import SimpleNamespace

import numpy as np
import pytest
import torch

from fv_vision.analytics.congestion import LANCAR, MACET, ZoneMonitor
from fv_vision.analytics.crowd import CrowdMonitor, split_riders
from fv_vision.analytics.tracks import Track
from fv_vision.analytics.weapon import WeaponScreen
from fv_vision.config import (MOTORCYCLE, PERSON, CAR, CongestionThresholds, CrowdConfig,
                              WeaponConfig, Zone)
from fv_vision.privacy import blur_heads, head_region


# --- F1: riders -------------------------------------------------------------

def test_person_on_a_motorcycle_is_a_rider_not_a_pedestrian():
    boxes = np.array([
        [100, 50, 120, 110],   # rider: bottom-centre (110, 110) sits in the bike
        [95, 70, 130, 120],    # motorcycle
        [300, 40, 315, 90],    # pedestrian on the pavement
    ], dtype=float)
    classes = np.array([PERSON, MOTORCYCLE, PERSON])
    walkers, riders = split_riders(boxes, classes, [MOTORCYCLE])
    assert walkers.tolist() == [[300, 40, 315, 90]]
    assert riders.tolist() == [[100, 50, 120, 110]]


def test_split_riders_without_vehicles_keeps_everyone():
    boxes = np.array([[0, 0, 10, 30], [20, 0, 30, 30]], dtype=float)
    walkers, riders = split_riders(boxes, np.array([PERSON, PERSON]), [MOTORCYCLE])
    assert len(walkers) == 2 and len(riders) == 0


# --- F1: median, peak, growth ----------------------------------------------

def test_live_count_is_the_median_so_one_bad_frame_does_not_move_it():
    m = CrowdMonitor(CrowdConfig(median_window=5, alert_count=999))
    for i, n in enumerate([10, 10, 10, 0, 10]):
        m.observe(i, 1_000_000 + i, n)
    assert m.count == 10


def test_peak_is_kept_with_its_time():
    m = CrowdMonitor(CrowdConfig(median_window=1, alert_count=999))
    for i, n in enumerate([3, 8, 5]):
        m.observe(i, 1_000_000 + i, n)
    assert (m.peak_count, m.peak_wall) == (8, 1_000_001)


# --- F2: alerts --------------------------------------------------------------

def test_count_alert_needs_the_threshold_held_for_the_hold_time_and_fires_once():
    m = CrowdMonitor(CrowdConfig(median_window=1, alert_count=20, alert_hold_seconds=60,
                                 alert_growth_per_min=999))
    fired = []
    for t in range(0, 200, 5):
        fired += [(t, a.kind) for a in m.observe(t, 1_000_000 + t, 25)]
    assert fired == [(60, "jumlah")]


def test_count_alert_rearms_after_the_crowd_drops():
    m = CrowdMonitor(CrowdConfig(median_window=1, alert_count=20, alert_hold_seconds=10,
                                 alert_growth_per_min=999))
    kinds = []
    for t, n in [(0, 25), (10, 25), (20, 5), (30, 25), (40, 25)]:
        kinds += [a.kind for a in m.observe(t, 1_000_000 + t, n)]
    assert kinds == ["jumlah", "jumlah"]


def test_short_spike_does_not_alert():
    m = CrowdMonitor(CrowdConfig(median_window=1, alert_count=20, alert_hold_seconds=60,
                                 alert_growth_per_min=999))
    kinds = []
    for t, n in [(0, 25), (30, 25), (40, 3), (50, 25)]:
        kinds += [a.kind for a in m.observe(t, 1_000_000 + t, n)]
    assert kinds == []


def test_growth_alert_uses_change_per_minute_and_cools_down():
    m = CrowdMonitor(CrowdConfig(median_window=1, alert_count=999, alert_growth_per_min=10,
                                 alert_cooldown_seconds=600))
    kinds = []
    for t in range(0, 181, 10):
        n = 0 if t < 60 else 30          # +30 people within a minute
        kinds += [(t, a.kind) for a in m.observe(t, 1_000_000 + t, n)]
    assert [k for _, k in kinds] == ["laju"]
    assert m.growth_per_min == pytest.approx(0.0, abs=0.01)  # steady again at 30


# --- F3: persistence ---------------------------------------------------------

class _FakeWeaponModel:
    """Returns a detection with the next confidence from a script."""

    names = {0: "parang", 1: "payung"}

    def __init__(self, confidences):
        self.confidences = list(confidences)

    def predict(self, crop, conf, classes, verbose):
        return [SimpleNamespace(boxes=_Boxes(self.confidences.pop(0)))]


class _Boxes:
    def __init__(self, c):
        self.conf = torch.tensor([c]) if c else torch.tensor([])

    def __len__(self):
        return len(self.conf)


def _screen(confidences, **cfg):
    screen = WeaponScreen(WeaponConfig(enabled=False, **cfg))  # no model loaded
    screen.model = _FakeWeaponModel(confidences)
    screen._class_ids = [0]
    return screen


def _person(track_id=1, height=200):
    return Track(id=track_id, first_t=0, last_t=0,
                 box=np.array([100, 50, 160, 50 + height], dtype=float))


def test_weapon_alert_needs_three_hits_in_five_screenings():
    screen = _screen([0.9, 0.0, 0.8, 0.0, 0.7], confidence=0.5, hits=3, window=5)
    image = np.zeros((400, 400, 3), np.uint8)
    person = _person()
    results = [screen.screen(image, [person]) for _ in range(5)]
    assert [len(r) for r in results] == [0, 0, 0, 0, 1]
    assert results[4][0].confidence == pytest.approx(0.9)


def test_scattered_single_hits_never_alert():
    screen = _screen([0.9, 0, 0, 0, 0, 0.9, 0, 0, 0, 0], confidence=0.5, hits=3, window=5)
    image = np.zeros((400, 400, 3), np.uint8)
    person = _person()
    assert all(not screen.screen(image, [person]) for _ in range(10))


def test_one_alert_per_tracked_person():
    screen = _screen([0.9] * 8, confidence=0.5, hits=3, window=5)
    image = np.zeros((400, 400, 3), np.uint8)
    person = _person()
    alerts = sum(len(screen.screen(image, [person])) for _ in range(8))
    assert alerts == 1


def test_people_below_the_size_gate_are_never_cropped():
    screen = _screen([], min_person_height_px=150)
    image = np.zeros((400, 400, 3), np.uint8)
    assert screen.screen(image, [_person(height=60)]) == []
    assert screen.eligible_last == 0


def test_weapon_screen_without_a_model_stays_off():
    screen = WeaponScreen(WeaponConfig(enabled=True, model=None))
    assert not screen.active


# --- privacy ----------------------------------------------------------------

def test_head_region_is_pixelated_and_the_rest_is_untouched():
    rng = np.random.default_rng(0)
    image = rng.integers(0, 255, (200, 200, 3), dtype=np.uint8)
    box = np.array([50, 20, 110, 180], dtype=float)
    out = blur_heads(image, [box])
    x1, y1, x2, y2 = head_region(box, 200, 200)
    head_before, head_after = image[y1:y2, x1:x2], out[y1:y2, x1:x2]
    # Pixelated to a few blocks: far fewer distinct colours than noise.
    assert len(np.unique(head_after.reshape(-1, 3), axis=0)) < \
        len(np.unique(head_before.reshape(-1, 3), axis=0)) / 10
    assert np.array_equal(out[150:, :], image[150:, :])


# --- vehicle density --------------------------------------------------------

def _zone_monitor(**th):
    zone = Zone("z", "Z", np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float),
                CongestionThresholds(**th))
    return ZoneMonitor(zone, zone.pixels(100, 100))


def test_first_reading_sets_status_then_changes_must_hold():
    m = _zone_monitor(occupancy_padat=0.2, occupancy_macet=0.4, hold_seconds=30)
    full = np.array([[0, 0, 100, 60]], float)  # 60 % occupancy
    empty = np.zeros((0, 4))
    m.observe(0, empty, [])
    assert m.status == LANCAR
    m.observe(10, full, [])
    m.observe(35, full, [])
    assert m.status == LANCAR           # 25 s of macet is not enough
    m.observe(41, full, [])
    assert m.status == MACET


def test_speed_from_a_minority_of_tracked_vehicles_is_ignored():
    m = _zone_monitor(occupancy_padat=0.9, occupancy_macet=0.95, speed_padat_px=40)
    boxes = np.array([[i * 10, 0, i * 10 + 5, 5] for i in range(6)], float)
    slow = Track(1, 0, 0, np.array([0, 0, 5, 5], float))
    slow.class_votes[CAR] += 1
    slow.history.extend([(0.0, 2.0, 5.0), (2.0, 2.0, 5.0)])  # not moving
    reading = m.observe(2.0, boxes, [slow])
    assert reading.avg_speed_px is None and reading.raw_status == LANCAR
