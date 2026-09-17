#!/bin/sh
# Rolls the running stack forward to the images the checkout points at.
#
# This is RUNBOOK-DEPLOY.md §3–§6 as one script, in the order the runbook
# insists on: a database dump first (migrations 010–014 rewrite production
# data in place, so there must be something to go back to), then pull, then
# the migrate profile — the step `docker compose up -d` never runs on its own
# — then the stack, then the read-only verification. It stops at the first
# failure and leaves the stack as it found it; there is no automatic rollback,
# because a half-applied migration is a decision for a person.
#
# Run on the host from the repository root, as a user who can run docker:
#
#     sh deploy/deploy.sh
#
# The CI `deploy` job runs exactly this over SSH after a push to `master` has
# published the images. Environment:
#
#   DEPLOY_PROFILES   compose profiles for `up` (default: proxy — the public VPS)
#   DEPLOY_BACKUP_DIR where the pre-deploy dump goes (default: /var/backups/factory-vision)
#   DEPLOY_KEEP_DUMPS how many dumps to keep (default: 10)
#   DEPLOY_SKIP_VERIFY=1  skip verify-deployment.sh (never on the production box)

set -eu

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
PROFILES="${DEPLOY_PROFILES:-proxy}"
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-/var/backups/factory-vision}"
KEEP="${DEPLOY_KEEP_DUMPS:-10}"

if [ ! -f deploy/.env ]; then
  echo "[deploy] deploy/.env tidak ada; ikuti RUNBOOK-DEPLOY.md §1 dulu." >&2
  exit 1
fi

# The values compose will interpolate, read the same way it reads them.
env_value() {
  grep -E "^$1=" deploy/.env | tail -1 | cut -d= -f2- | tr -d '\r'
}
POSTGRES_USER="$(env_value POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-factory}"
POSTGRES_DB="$(env_value POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-factory_vision}"
IMAGE_TAG="$(env_value IMAGE_TAG)"; IMAGE_TAG="${IMAGE_TAG:-master}"

echo "[deploy] $(date -u +%FT%TZ) tag=$IMAGE_TAG profiles=$PROFILES commit=$(git rev-parse --short HEAD 2>/dev/null || echo '?')"

# 1. Dump before anything changes. The database must already be up; on a
#    first install there is nothing to dump, and the runbook is the path.
if $COMPOSE ps --services --filter status=running 2>/dev/null | grep -qx db; then
  mkdir -p "$BACKUP_DIR"
  dump="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  echo "[deploy] pg_dump → $dump"
  $COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$dump"
  [ -s "$dump" ] || { echo "[deploy] dump kosong; berhenti sebelum menyentuh apa pun." >&2; exit 1; }
  # Keep the last N; a directory that fills the disk takes the stack with it.
  ls -1t "$BACKUP_DIR"/pre-deploy-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
else
  echo "[deploy] service db belum berjalan; instalasi pertama? Ikuti RUNBOOK-DEPLOY.md." >&2
  exit 1
fi

# 2. Pull what CI published for this tag.
echo "[deploy] docker compose pull"
COMPOSE_PROFILES="$PROFILES" $COMPOSE pull --quiet

# 3. Migrate — the step `up -d` never runs on its own (RUNBOOK §4).
echo "[deploy] migrate"
$COMPOSE --profile migrate run --rm migrate

# 4. Roll the stack forward. Traefik labels are baked at container creation,
#    so a changed image or env means recreate, which `up -d` does when needed.
echo "[deploy] up -d"
COMPOSE_PROFILES="$PROFILES" $COMPOSE up -d --remove-orphans

# 5. Wait until nothing is still starting, bounded so a wedged container fails
#    the deploy instead of hanging the job.
i=0
while [ "$($COMPOSE ps --format '{{.Status}}' 2>/dev/null | grep -c 'health: starting')" != "0" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[deploy] container masih 'health: starting' setelah 5 menit:" >&2
    $COMPOSE ps >&2
    exit 1
  fi
  sleep 5
done
$COMPOSE ps --format 'table {{.Service}}\t{{.Status}}'

unhealthy="$($COMPOSE ps --format '{{.Service}} {{.Status}}' | grep -i 'unhealthy' || true)"
if [ -n "$unhealthy" ]; then
  echo "[deploy] service tidak sehat:" >&2
  echo "$unhealthy" >&2
  exit 1
fi

# 6. Read-only verification (RUNBOOK §6): the release landed, not just the
#    containers.
if [ "${DEPLOY_SKIP_VERIFY:-0}" != "1" ]; then
  sh deploy/verify-deployment.sh
fi

# Old images pile up on a small VPS; keep what the running stack references.
docker image prune -f > /dev/null 2>&1 || true

echo "[deploy] selesai: $(date -u +%FT%TZ)"
