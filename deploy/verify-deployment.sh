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
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected $3, got '$2'"; fi
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
expect "migrasi 023-032 diterapkan" \
  "$(q "SELECT count(*) FROM schema_migrations WHERE version >= '023' AND version < '033'")" "10"

expect "tabel improvement ada" \
  "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('operational_event','material_inventory','inspection','maintenance_record','operator_qualification','wip_record','mrp_run')")" "7"

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
base="${VERIFY_BASE_URL:-http://localhost:4000}"
health=$(curl -s -o /dev/null -w '%{http_code}' "$base/health" 2>/dev/null)
expect "GET /health" "$health" "200"

# Unauthenticated must be refused, not served. 401 is the pass here: a 200
# would mean the improvement endpoints are open.
for path in /api/v1/materials/inventory /api/v1/quality/dashboard /api/v1/maintenance/kpi \
            /api/v1/workforce/dashboard /api/v1/wip/dashboard /api/v1/production-board /api/v1/events; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base$path" 2>/dev/null)
  if [ "$code" = "401" ]; then
    ok "$path menolak permintaan tanpa sesi (401)"
  else
    bad "$path menolak permintaan tanpa sesi" "HTTP $code"
  fi
done

# ------------------------------------------------------------------- summary
printf '\n%d lulus, %d gagal.\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
