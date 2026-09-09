#!/bin/sh
# Factory Vision — automated database and document backup (§39, §41).
#
# Run by the `backup` service in docker-compose, which invokes it once a day.
# It can also be run by hand on the host:
#
#   docker compose -f deploy/docker-compose.yml run --rm backup /backup.sh
#
# What it produces, under /backup (the `backup-data` volume):
#
#   db/factory-vision-<timestamp>.sql.gz[.enc]
#   documents/documents-<timestamp>.tar.gz[.enc]
#
# Encryption is on whenever BACKUP_PASSPHRASE is set, and the requirement is
# that it be set for anything leaving the plant. A backup is a complete copy of
# the factory's production data with none of the application's access control
# in front of it, which is exactly why it is the copy worth stealing.
#
# Offsite copying is deliberately left to the customer's own tooling (rsync to
# a NAS, rclone to object storage, a tape rotation): it is the one step that
# depends on infrastructure this compose file cannot see. BACKUP_OFFSITE_CMD is
# the hook for it, and it runs after a successful backup.

set -eu

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-/backup}"
DB_DIR="$BACKUP_ROOT/db"
DOC_DIR="$BACKUP_ROOT/documents"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$DB_DIR" "$DOC_DIR"

log() { echo "[backup] $*"; }

# §43: a backup that stopped running is a security event, and the only place
# that knows is this script. If an alert webhook is configured, it hears about
# a failure here rather than at the next restore attempt.
alert() {
  log "ALERT: $*"
  [ -n "${SECURITY_ALERT_WEBHOOK:-}" ] || return 0
  payload="{\"text\":\"[Factory Vision] CRITICAL: backup failed - $*\",\"event\":{\"type\":\"BACKUP_FAILED\",\"severity\":\"CRITICAL\"}}"
  wget -q -O /dev/null --header='Content-Type: application/json' --post-data "$payload"     "$SECURITY_ALERT_WEBHOOK" 2>/dev/null || log "alert webhook unreachable"
}

# Any unexpected failure below reports before the shell exits.
trap 'alert "backup run aborted"' EXIT

encrypt_or_move() {
  # $1 = plaintext file, $2 = destination without .enc
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -pass env:BACKUP_PASSPHRASE -in "$1" -out "$2.enc"
    rm -f "$1"
    log "encrypted -> $(basename "$2.enc")"
  else
    mv "$1" "$2"
    log "WARNING: BACKUP_PASSPHRASE is not set, wrote an unencrypted backup: $(basename "$2")"
  fi
}

# --- Database ---------------------------------------------------------------
DB_TMP="$BACKUP_ROOT/.db-$STAMP.sql.gz"
log "dumping database ${POSTGRES_DB:-factory_vision} from ${PGHOST:-db}"
PGPASSWORD="${PGPASSWORD:-}" pg_dump \
  --host "${PGHOST:-db}" \
  --username "${PGUSER:-factory}" \
  --dbname "${POSTGRES_DB:-factory_vision}" \
  --no-owner --clean --if-exists \
  | gzip -9 > "$DB_TMP"
encrypt_or_move "$DB_TMP" "$DB_DIR/factory-vision-$STAMP.sql.gz"

# --- Documents --------------------------------------------------------------
# Order attachments live on their own volume, so a database restore and a
# document restore stay independent operations.
if [ -d "${DOCUMENT_SOURCE:-/data/documents}" ]; then
  DOC_TMP="$BACKUP_ROOT/.documents-$STAMP.tar.gz"
  tar -czf "$DOC_TMP" -C "${DOCUMENT_SOURCE:-/data/documents}" .
  encrypt_or_move "$DOC_TMP" "$DOC_DIR/documents-$STAMP.tar.gz"
else
  log "no document directory at ${DOCUMENT_SOURCE:-/data/documents}, skipping attachments"
fi

# --- Retention --------------------------------------------------------------
find "$DB_DIR" "$DOC_DIR" -type f -mtime "+$RETENTION_DAYS" -print -delete | while read -r old; do
  log "expired $(basename "$old")"
done

# --- Offsite ----------------------------------------------------------------
if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  log "running offsite copy"
  sh -c "$BACKUP_OFFSITE_CMD"
fi

trap - EXIT
log "done: $(ls -1 "$DB_DIR" | wc -l) database backup(s) retained, keeping $RETENTION_DAYS days"
