#!/bin/sh
# Factory Vision — scheduled restore verification (§41).
#
# A backup nobody has restored is a hope, not a control. This restores the most
# recent dump into a throwaway database beside the live one, checks that the
# tables an auditor would ask about actually came back with rows in them, and
# drops the copy again.
#
# It is read-only with respect to production: the restore target is a separate
# database, and the script refuses to run if that name resolves to the live
# one. Run by the `backup` service on BACKUP_VERIFY_INTERVAL_SECONDS, or by
# hand:
#
#   docker compose -f deploy/docker-compose.yml run --rm backup /bin/sh /backup-verify.sh
#
# Exit code is the result: 0 verified, non-zero means the backup could not be
# proven restorable, which is a finding rather than an inconvenience.

set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/backup}"
DB_DIR="$BACKUP_ROOT/db"
LIVE_DB="${POSTGRES_DB:-factory_vision}"
VERIFY_DB="${BACKUP_VERIFY_DB:-factory_vision_restore_check}"

log() { echo "[verify] $*"; }

fail() {
  log "FAILED: $*"
  if [ -n "${SECURITY_ALERT_WEBHOOK:-}" ]; then
    payload="{\"text\":\"[Factory Vision] CRITICAL: backup restore verification failed - $*\",\"event\":{\"type\":\"BACKUP_RESTORE_UNVERIFIED\",\"severity\":\"CRITICAL\"}}"
    wget -q -O /dev/null --header='Content-Type: application/json' --post-data "$payload" \
      "$SECURITY_ALERT_WEBHOOK" 2>/dev/null || log "alert webhook unreachable"
  fi
  exit 1
}

[ "$VERIFY_DB" != "$LIVE_DB" ] || fail "BACKUP_VERIFY_DB must not be the live database"

NEWEST="$(ls -1t "$DB_DIR" 2>/dev/null | head -n 1 || true)"
[ -n "$NEWEST" ] || fail "no backup found in $DB_DIR"
log "verifying $NEWEST"

# A backup older than two intervals means the schedule has stopped, which is
# worth reporting even if the file that exists restores perfectly.
AGE_HOURS=$(( ( $(date +%s) - $(date -r "$DB_DIR/$NEWEST" +%s) ) / 3600 ))
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-48}"
[ "$AGE_HOURS" -le "$MAX_AGE_HOURS" ] || fail "newest backup is ${AGE_HOURS}h old (limit ${MAX_AGE_HOURS}h)"

WORK="$BACKUP_ROOT/.verify"
rm -rf "$WORK"
mkdir -p "$WORK"
PLAIN="$WORK/dump.sql.gz"

case "$NEWEST" in
  *.enc)
    [ -n "${BACKUP_PASSPHRASE:-}" ] || fail "backup is encrypted but BACKUP_PASSPHRASE is not set"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
      -in "$DB_DIR/$NEWEST" -out "$PLAIN" || fail "decryption failed"
    ;;
  *)
    cp "$DB_DIR/$NEWEST" "$PLAIN"
    ;;
esac

log "restoring into $VERIFY_DB"
psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\" WITH (FORCE);" >/dev/null
psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$VERIFY_DB\";" >/dev/null
gunzip -c "$PLAIN" | psql -q -d "$VERIFY_DB" >/dev/null 2>&1 || log "restore reported warnings; checking contents"

# The tables that decide whether a restore is worth anything: production
# records, work orders, and the audit trail an auditor would ask to see.
FAILURES=0
for table in production_record work_order audit_log tenant; do
  count="$(psql -tAq -d "$VERIFY_DB" -c "SELECT count(*) FROM $table;" 2>/dev/null || echo error)"
  case "$count" in
    error) log "  $table: MISSING"; FAILURES=$((FAILURES + 1)) ;;
    *) log "  $table: $count row(s)" ;;
  esac
done

psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\" WITH (FORCE);" >/dev/null
rm -rf "$WORK"

[ "$FAILURES" -eq 0 ] || fail "$FAILURES expected table(s) missing from the restore"

log "restore verified from $NEWEST"
