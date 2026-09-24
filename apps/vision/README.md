# apps/vision — camera analytics worker

Turns one camera stream into a people count, crowd alerts, potential-weapon
alerts for an operator to verify, and vehicle density per road zone, written
to its own PostgreSQL database. Python (OpenCV, YOLO11 via Ultralytics,
ByteTrack via Supervision), CPU only.

The first camera is the DKI public CCTV **JKP Satpol PP Gatot Subroto C11
CCTV-01** (Crowd Safety Vision prototype). The pieces are meant to carry over
to a plant: headcount per area, a second-stage check on person crops (PPE
instead of weapons), density of a WIP buffer.

| PRD | What | Where | Output |
|---|---|---|---|
| F0 | HLS / fMP4 ingest, 1 of N frames, paced by timestamps, reconnect; one YAML per camera | `ingest.py`, `config.py` | `stream_log` |
| F1 | People in the whole frame, riders (person on a motorcycle box) excluded; median of 10 frames; peak; growth per minute | `analytics/crowd.py` | `people_live` (5 s), `people_log` (1 min) |
| F2 | Alert on count held ≥ 60 s, or on growth per minute | `analytics/crowd.py` | `crowd_alert` |
| F3 | *Potential* sharp weapon: crop people ≥ 150 px, fine-tuned model, ≥ 3 hits in 5 screenings, snapshot crop | `analytics/weapon.py` | `weapon_alert` |
| F4 | Operator decision konfirmasi / tolak, append-only | dashboard buttons; `pending` / `verify` commands | `weapon_alert_verification`, view `weapon_alert_status` |
| — | Vehicle density per road zone: lancar / padat / macet | `analytics/congestion.py` | `zone_live`, `zone_status` |
| UI | Dashboard: live view, counts, trend, alerts with Konfirmasi / Tolak, history, CSV | `web/` (`serve`) | `dashboard_user`, `audit_log` |

No face recognition and no identity: track ids stay in memory, no video is
recorded, snapshots are pruned after 30 days. Face blurring (`privacy.py`,
`blur_faces` per camera) is available but off: the product owner chose plain
frames on 2026-09-24, since the system identifies nobody.

## What the C11 camera allows (measured 2026-09-24)

- 640x360, 20 fps, fMP4 segments of 7.5 s. End-to-end delay from the camera's
  own clock to analysis: ~25 s, steady (PRD: ≤ 30 s).
- People are 11–61 px tall; **nobody reaches the 150 px F3 gate**, so F3
  cannot run on this camera and stays off in `config/c11.yaml`. Most people
  in frame are motorcycle riders, which is why the rider filter matters.
- YOLO11s at 960x544 on a 4-core dev machine, in the Linux image capped at 3
  CPUs: OpenVINO 346 ms a frame, PyTorch 581 ms (natively on Windows the
  order flips: 960 vs 425). ~2 analysed FPS end to end (PRD: ≥ 1).

## Counting from detections, not tracks

At 1–2 analysed frames a second, ByteTrack only confirms a track for things
that barely move between frames. Counts and occupancy therefore come from
each frame's raw detections; tracks are used only where identity over time
matters (vehicle speed, F3 persistence), and a zone's speed is ignored unless
most of its vehicles are tracked.

## Local

```bash
cd apps/vision
python -m venv .venv
.venv/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/pip install -r requirements.txt pytest

.venv/Scripts/python -m fv_vision probe              # resolution / fps of the stream
.venv/Scripts/python -m fv_vision bench yolo11s.pt yolo11s_openvino_model
.venv/Scripts/python -m fv_vision roi                # draw road zones
.venv/Scripts/python -m fv_vision run --show         # overlay window, results to the log
.venv/Scripts/python -m pytest tests                 # + VISION_TEST_DATABASE_URL for the DB tests
```

Without `VISION_DATABASE_URL` the worker logs what it would write. With it
(`postgresql://fv_vision:…@host:5432/fv_vision`) it creates its tables on
start. `VISION_SOURCE` overrides the camera URL, e.g. with a recorded file for
an offline demo. An OpenVINO export must match the config's `imgsz`:
`YOLO('yolo11s.pt').export(format='openvino', imgsz=[544, 960])`.

## F3 / F4

F3 is off until a fine-tuned model exists (PRD weeks 3–5). To turn it on for
a camera where people are large enough: set `weapon.enabled`, `weapon.model`
(or `VISION_WEAPON_MODEL`) and `weapon.classes`. A missing or unloadable model
logs an error and leaves F3 off; the rest keeps running. Operators decide in
the dashboard; the terminal does the same:

```bash
python -m fv_vision pending
python -m fv_vision verify 12 tolak --by "nama operator" --note "payung"
```

A later decision supersedes an earlier one without erasing it.

## Dashboard

`python -m fv_vision serve` (FastAPI on :8000), a separate process from the
worker so either restarts alone. The worker writes the newest annotated frame
and live figures to `VISION_LIVE_DIR`; the dashboard reads them, the database
and the snapshots.

- **Pemantauan**: live view in two modes — *Deteksi*, the analysed frames with
  boxes (±2 per second, MJPEG), and *Video langsung*, the camera's own HLS
  stream in the browser at full rate (hls.js from jsdelivr; the DKI cameras
  allow cross-origin playback). Boxes are not drawn over the live video: they
  would trail the motion by the analysis delay. Cards for people now / peak /
  growth (red or amber past the F2 thresholds), road-zone status, F3 state; a
  per-minute trend (1 hour, today, 7 days); the alert list, pushed over a
  WebSocket, with Konfirmasi / Tolak on potential-weapon alerts.
- **Riwayat**: alerts by date and type, CSV export of alerts (with the
  verification) and of per-minute counts.
- Accounts in `dashboard_user` (scrypt, roles admin / operator), a signed
  session cookie, a CSRF header on every write, a login throttle, a strict
  CSP, and `audit_log` rows for login, viewing, snapshot views, verification
  and exports. The first admin comes from `VISION_ADMIN_USER` /
  `VISION_ADMIN_PASSWORD`; more with `python -m fv_vision user add`.

Locally, with the worker running against the same database:

```bash
VISION_DATABASE_URL=... VISION_CONFIG_DIR=config VISION_SESSION_SECRET=dev \
  .venv/Scripts/python -m fv_vision serve --port 8765
```

Not yet: the admin configuration page (thresholds and F3 per camera live in
the camera YAML for now).

## Deployment

A `vision` profile in `deploy/docker-compose.yml`, off by default:

```bash
# deploy/.env: VISION_DB_PASSWORD, VISION_SESSION_SECRET, VISION_ADMIN_USER,
# VISION_ADMIN_PASSWORD, VISION_DOMAIN (+ a DNS A record for it)
COMPOSE_PROFILES=proxy,vision docker compose -f deploy/docker-compose.yml \
  --env-file deploy/.env up -d --build vision vision-web
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f vision
# which model format is faster on this CPU (default: OpenVINO):
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile vision \
  run --rm vision bench /models/yolo11s.pt /models/yolo11s_openvino_model
```

`vision-init` creates the `fv_vision` role and database (idempotent,
`deploy/vision-init.sql`); the worker then creates its tables. `vision` and
`vision-web` run the same image and share the `vision-data` volume
(read-only for the dashboard). The image is built on the host — CI does not
publish it. It is capped at `VISION_CPUS`
(default 3) so the MES keeps a core. Once it runs on a host, deploy the MES
with `DEPLOY_PROFILES=proxy,vision sh deploy/deploy.sh`. The nightly backup
covers `factory_vision` only, not `fv_vision`.

## Not yet

The dashboard's admin configuration page, a camera-moved check, and F5 / F6
from the PRD.
Supervision deprecated `ByteTrack` in 0.28 and removes it in 0.31; it is
pinned at 0.30.5 until the tracker is swapped.

Stream use: the DKI CCTV feeds are used for internal research and demo only;
operational use needs the camera owner's permission (PRD, Privasi & Etika).
