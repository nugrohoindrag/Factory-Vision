-- Vision worker schema, in its own database (fv_vision) beside factory_vision.
-- Applied by the worker on every start, so every statement is idempotent.
--
-- Nothing here identifies a person: counts, alerts and event snapshots, no
-- face recognition. Track ids never leave memory.

-- F1: live figure, one row per camera, rewritten every few seconds.
CREATE TABLE IF NOT EXISTS people_live (
    camera_id        text        PRIMARY KEY,
    updated_at       timestamptz NOT NULL,
    count            integer     NOT NULL,
    growth_per_min   real        NOT NULL,
    peak_count       integer     NOT NULL,
    peak_at          timestamptz
);

-- F1: per-minute log.
CREATE TABLE IF NOT EXISTS people_log (
    camera_id        text        NOT NULL,
    ts               timestamptz NOT NULL,
    avg_count        real        NOT NULL,
    min_count        integer     NOT NULL,
    max_count        integer     NOT NULL,
    PRIMARY KEY (camera_id, ts)
);

-- F2.
CREATE TABLE IF NOT EXISTS crowd_alert (
    id               bigserial   PRIMARY KEY,
    ts               timestamptz NOT NULL,
    camera_id        text        NOT NULL,
    kind             text        NOT NULL CHECK (kind IN ('jumlah', 'laju')),
    count            integer     NOT NULL,
    growth_per_min   real        NOT NULL,
    threshold        real        NOT NULL
);
CREATE INDEX IF NOT EXISTS crowd_alert_camera_ts ON crowd_alert (camera_id, ts DESC);

-- F3: a *potential* weapon. Immutable once written.
CREATE TABLE IF NOT EXISTS weapon_alert (
    id               bigserial   PRIMARY KEY,
    ts               timestamptz NOT NULL,
    camera_id        text        NOT NULL,
    confidence       real        NOT NULL,
    snapshot_path    text,
    model            text        NOT NULL
);
CREATE INDEX IF NOT EXISTS weapon_alert_camera_ts ON weapon_alert (camera_id, ts DESC);

-- F4: operator decisions, append-only. A later decision supersedes an
-- earlier one without erasing it, so the history is its own audit trail and
-- the tuning set keeps every judgement.
CREATE TABLE IF NOT EXISTS weapon_alert_verification (
    id               bigserial   PRIMARY KEY,
    alert_id         bigint      NOT NULL REFERENCES weapon_alert (id),
    decision         text        NOT NULL CHECK (decision IN ('konfirmasi', 'tolak')),
    verified_by      text        NOT NULL,
    verified_at      timestamptz NOT NULL DEFAULT now(),
    note             text
);
CREATE INDEX IF NOT EXISTS weapon_alert_verification_alert
    ON weapon_alert_verification (alert_id, verified_at DESC);

CREATE OR REPLACE VIEW weapon_alert_status AS
SELECT a.*,
       COALESCE(v.decision, 'menunggu') AS status,
       v.verified_by,
       v.verified_at,
       EXTRACT(EPOCH FROM v.verified_at - a.ts) AS seconds_to_verify
  FROM weapon_alert a
  LEFT JOIN LATERAL (
        SELECT decision, verified_by, verified_at
          FROM weapon_alert_verification
         WHERE alert_id = a.id
         ORDER BY verified_at DESC, id DESC
         LIMIT 1) v ON true;

-- Vehicle density per road zone.
CREATE TABLE IF NOT EXISTS zone_live (
    camera_id        text        NOT NULL,
    zone_id          text        NOT NULL,
    updated_at       timestamptz NOT NULL,
    status           text        NOT NULL,
    status_since     timestamptz NOT NULL,
    vehicle_count    integer     NOT NULL,
    occupancy        real        NOT NULL,
    avg_speed_px     real,
    PRIMARY KEY (camera_id, zone_id)
);

CREATE TABLE IF NOT EXISTS zone_status (
    camera_id        text        NOT NULL,
    zone_id          text        NOT NULL,
    ts               timestamptz NOT NULL,
    status           text        NOT NULL,
    vehicle_count    real        NOT NULL,
    occupancy        real        NOT NULL,
    avg_speed_px     real,
    PRIMARY KEY (camera_id, zone_id, ts)
);

-- Stream up/down transitions, for the uptime figure.
CREATE TABLE IF NOT EXISTS stream_log (
    ts               timestamptz NOT NULL,
    camera_id        text        NOT NULL,
    state            text        NOT NULL,
    detail           text
);
CREATE INDEX IF NOT EXISTS stream_log_camera_ts ON stream_log (camera_id, ts DESC);

-- Dashboard accounts. Password: scrypt$<salt b64>$<hash b64>, the same shape
-- as the MES. admin may export and manage; operator views and verifies.
CREATE TABLE IF NOT EXISTS dashboard_user (
    username         text        PRIMARY KEY,
    display_name     text        NOT NULL,
    role             text        NOT NULL CHECK (role IN ('admin', 'operator')),
    password_hash    text        NOT NULL,
    disabled         boolean     NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- PRD: who viewed, exported or verified what. Append-only by convention —
-- the application never updates or deletes a row here.
CREATE TABLE IF NOT EXISTS audit_log (
    id               bigserial   PRIMARY KEY,
    ts               timestamptz NOT NULL DEFAULT now(),
    username         text,
    action           text        NOT NULL,
    target           text,
    detail           jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_ts ON audit_log (ts DESC);
