#!/bin/sh
# Post-deploy verification for the MES Improvement release.
#
# Read-only. It starts nothing, migrates nothing and writes nothing — it asks
# the deployed stack whether the release actually landed, and prints one line
# per check so a failure names itself instead of hiding in a log.
#
# Run it on the host, from the repository root, after
# `docker compose ... --profile migrate run --rm migrate` and `up -d`:
#
#     sh deploy/verify-deployment.sh
#
# Exit code is 0 when every check passes, 1 otherwise, so it can gate a
# deployment script as well as a pair of eyes.

set -u

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL  %s — %s\n' "$1" "$2"; }

# One psql round trip, tuple-only, whitespace trimmed.
#
# VERIFY_PSQL overrides how psql is reached. It exists so this script can be
# exercised against a database that is not behind this compose file — which is
# how it was tested before it was ever run on a production host.
q() {
  if [ -n "${VERIFY_PSQL:-}" ]; then
    $VERIFY_PSQL -t -A -c "$1" 2>/dev/null | tr -d '\r' | head -1
  else
    $COMPOSE exec -T db psql -U "${POSTGRES_USER:-factory}" -d "${POSTGRES_DB:-factory_vision}" \
      -t -A -c "$1" 2>/dev/null | tr -d '\r' | head -1
  fi
}

expect() { # label, actual, wanted
  if [ "$2" = "$3" ]; then
    ok "$1"
  elif [ -z "$2" ]; then
    # A count query that returns nothing did not return zero — it did not run.
    # psql's stderr is discarded in q(), so without this an unknown relation, a
    # bad column or a refused connection all arrive looking like a data
    # failure, and the reader goes hunting in the wrong place.
    bad "$1" "query tidak menghasilkan apa pun (kemungkinan tabel/kolom tidak ada atau koneksi psql gagal), harusnya $3"
  else
    bad "$1" "expected $3, got '$2'"
  fi
}

printf '\nMES Improvement — verifikasi setelah deploy\n\n'

# ---------------------------------------------------------------- containers
printf '1. Service\n'
# `--services --filter status=running` rather than a Go template: the template
# form of `ps --format` is not accepted by every Compose v2 build, and this
# script has to run on whatever the host happens to have.
running=$($COMPOSE ps --services --filter status=running 2>/dev/null | tr -d '\r')
for svc in db api worker console operator; do
  if printf '%s\n' "$running" | grep -qx "$svc"; then
    ok "$svc berjalan"
  else
    bad "$svc berjalan" "tidak ada dalam daftar service yang running"
  fi
done

# ---------------------------------------------------------------- migrations
printf '\n2. Migrasi\n'
# Not `SELECT count(*) FROM schema_migrations`. That table is written by
# `pnpm db:migrate`, which needs a source checkout. A pull-based host has none:
# it runs the migration runner inside the API image, and that runner keeps no
# state table at all — it replays the whole directory on every deploy, which is
# precisely why every migration has to be idempotent. Asking for the
# bookkeeping asks for a table that will never exist on this host, and psql's
# error arrives here as an empty string.
#
# So ask the schema what the migrations built, which is the thing that actually
# matters. 023 and 032 create no table; they are checked just below and under
# RBAC respectively.
expect "tabel improvement ada (024-031)" \
  "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('app_session','user_mfa','operational_event','material_inventory','mrp_run','inspection','quality_hold','maintenance_plan','maintenance_record','skill','operator_qualification','wip_record','wip_transfer')")" "13"

# 023 makes audit_log append-only by privilege — the same control 026 applies
# to operational_event. It creates no table, so this grant is its only trace.
expect "audit_log append-only (023)" \
  "$(q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_name='audit_log' AND grantee='${APP_DB_USER:-factory_app}' AND privilege_type IN ('UPDATE','DELETE')")" "0"

# ------------------------------------------------------------------ security
printf '\n3. Isolasi & hak akses\n'
expect "policy tenant_isolation terpasang" \
  "$(q "SELECT count(*) FROM pg_policies WHERE policyname='tenant_isolation' AND tablename IN ('operational_event','material_inventory','inspection','maintenance_record','operator_qualification','wip_record','mrp_run','bill_of_material')")" "8"

# BR-E01/BR-E02: the application role may append and read the timeline, never
# rewrite it. This is the control, not the convention.
expect "operational_event append-only (BR-E01/E02)" \
  "$(q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_name='operational_event' AND grantee='${APP_DB_USER:-factory_app}' AND privilege_type IN ('UPDATE','DELETE')")" "0"

expect "operational_event dapat ditulis" \
  "$(q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_name='operational_event' AND grantee='${APP_DB_USER:-factory_app}' AND privilege_type='INSERT'")" "1"

expect "role aplikasi tunduk pada RLS" \
  "$(q "SELECT count(*) FROM pg_roles WHERE rolname='${APP_DB_USER:-factory_app}' AND NOT rolsuper AND NOT rolbypassrls")" "1"

# 033. Without this row every trial registration fails on a foreign key after
# the form has validated, and the public endpoint check below cannot see it
# because it sends an empty body on purpose.
expect "paket trial ada (033)" \
  "$(q "SELECT count(*) FROM subscription_plan WHERE id='plan-trial'")" "1"

# ---------------------------------------------------------------------- rbac
printf '\n4. Peran & permission (PRD §34, §35)\n'
expect "11 system role" "$(q "SELECT count(*) FROM role_definition WHERE is_system")" "11"

expect "peran baru MAINTENANCE/WAREHOUSE/WORKFORCE_ADMIN" \
  "$(q "SELECT count(DISTINCT key) FROM role_definition WHERE key IN ('MAINTENANCE','WAREHOUSE','WORKFORCE_ADMIN')")" "3"

# Backfilled by migration 032. Zero here means the migration ran but granted
# nothing, which leaves every new screen invisible to every existing role.
granted=$(q "SELECT count(DISTINCT permission) FROM role_permission WHERE permission ~ '^(material|quality|maintenance|workforce|wip|mrp|ncr|production_board):' OR permission='event:view'")
if [ "${granted:-0}" -ge 30 ] 2>/dev/null; then
  ok "permission improvement ter-backfill ($granted)"
else
  bad "permission improvement ter-backfill" "hanya $granted, migrasi 032 mungkin belum jalan"
fi

# US-006: every id is module:action. A third segment slips past `perm()` and
# leaves the verb unparsed.
expect "tidak ada permission id malformed (US-006)" \
  "$(q "SELECT count(*) FROM role_permission WHERE permission !~ '^[a-z_]+:[a-z_]+\$'")" "0"

# ------------------------------------------------------------------ endpoint
printf '\n5. API\n'

# Asked from inside the api container, not from the host.
#
# The API's port is deliberately not published: traefik is the front door, so
# `curl localhost:4000` on the host returns nothing and every check below would
# report a failure against a perfectly healthy API. That is what the first
# version of this script did on the pilot host.
#
# `node -e` rather than curl because the runtime image carries node and not
# much else — it is the same call the container's own HEALTHCHECK makes.
# VERIFY_BASE_URL still overrides, for a host that does publish the port.
api_probe() { # path [method] -> status code, or 000
  local method="${2:-GET}"
  if [ -n "${VERIFY_BASE_URL:-}" ]; then
    if [ "$method" = "GET" ]; then
      curl -s -o /dev/null -w '%{http_code}' "${VERIFY_BASE_URL}$1" 2>/dev/null
    else
      curl -s -o /dev/null -w '%{http_code}' -X "$method" \
        -H 'Content-Type: application/json' -d '{}' "${VERIFY_BASE_URL}$1" 2>/dev/null
    fi
  else
    $COMPOSE exec -T api node -e "
      const init = '$method' === 'GET'
        ? {}
        : { method: '$method', headers: { 'content-type': 'application/json' }, body: '{}' };
      fetch('http://127.0.0.1:4000$1', init)
        .then(r => console.log(r.status))
        .catch(() => console.log('000'));
    " 2>/dev/null | tr -d '\r' | head -1
  fi
}

expect "GET /health" "$(api_probe /health)" "200"

# Unauthenticated must be refused, not served. 401 is the pass here: a 200
# would mean the improvement endpoints are open.
for path in /api/v1/materials/inventory /api/v1/quality/dashboard /api/v1/maintenance/kpi \
            /api/v1/workforce/dashboard /api/v1/wip/dashboard /api/v1/production-board /api/v1/events; do
  code=$(api_probe "$path")
  if [ "$code" = "401" ]; then
    ok "$path menolak permintaan tanpa sesi (401)"
  else
    bad "$path menolak permintaan tanpa sesi" "HTTP $code"
  fi
done

# The public trial form is the one endpoint a prospect reaches with no account,
# so a release that loses it fails silently until somebody tries to sign up.
# An empty body must come back as a 422 from the route's own validator: a 404
# means the route is not mounted, a 5xx that the API cannot serve it, and a
# 429 that this source has already used up its registrations for the hour.
expect "POST /api/v1/auth/trial-register (formulir kosong)"   "$(api_probe /api/v1/auth/trial-register POST)" "422"

# ------------------------------------------------------------------- summary
printf '\n%d lulus, %d gagal.\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
