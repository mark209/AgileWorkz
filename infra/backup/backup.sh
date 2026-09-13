#!/bin/sh
# AgileWorks HVAC ERP — off-platform PostgreSQL backup job (Phase 7 P0).
#
# Runs weekly as a Render Cron Job (Docker: postgres:18-alpine + rclone +
# curl + jq, see ./Dockerfile). Dumps production via the least-privilege
# app_backup role, uploads the compressed directory-format archive to a
# dedicated, private Cloudflare R2 bucket, independently and
# deterministically verifies the upload actually landed before declaring
# success, and pings an external dead-man's-switch monitor only on a
# verified success. See README.md for every environment variable this
# script reads and the restore procedure.
#
# Design constraints (docs/architecture/phase7-p0-offplatform-backup-design.md):
#   - Every credential (Postgres, R2, heartbeat) is sourced exclusively
#     from environment variables — never hardcoded, never printed, and
#     never passed as a command-line argument to any tool, since argv is
#     visible to anything that can run `ps` in the same container. Postgres
#     auth uses libpq's own PG* environment variables; rclone reads its R2
#     credentials from RCLONE_CONFIG_R2_* environment variables; curl
#     receives the heartbeat URL via a config file piped over stdin
#     (`-K -`), never as an argument.
#   - POSIX sh, not bash: runs unmodified on postgres:18-alpine's stock
#     shell. No `pipefail` (a bash-only option) — every step that could
#     fail silently in a pipeline is captured and checked explicitly.
#   - Never `set -x` — would echo every command into Render's logs
#     unnecessarily.
#   - Success requires, in order: pg_dump succeeds -> compression succeeds
#     -> R2 upload succeeds -> the uploaded object is independently
#     confirmed, via an exact-name JSON match (not a prefix guess), to
#     exist with a non-zero size. Only then are temp files removed and the
#     heartbeat pinged.
#   - Temp files are always cleaned up, success or failure, via a POSIX
#     EXIT trap (`trap ... 0`), which does not alter the script's real
#     exit status.
#   - If the backup itself succeeds but the heartbeat ping fails, that is
#     logged as a distinct condition (never "backup failed") and the
#     script still exits non-zero, so a monitoring/network problem stays
#     visible to Render's own failure alerting even though the backup data
#     is fine.
set -eu

fail() {
  echo "BACKUP FAILED: $1" >&2
  exit 1
}

# Fail fast with a clear message if any required variable is missing —
# never print the value of any of them.
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${HEARTBEAT_URL:?HEARTBEAT_URL is required}"
: "${RCLONE_CONFIG_R2_TYPE:?RCLONE_CONFIG_R2_TYPE is required}"
: "${RCLONE_CONFIG_R2_PROVIDER:?RCLONE_CONFIG_R2_PROVIDER is required}"
: "${RCLONE_CONFIG_R2_ENDPOINT:?RCLONE_CONFIG_R2_ENDPOINT is required}"
: "${RCLONE_CONFIG_R2_REGION:?RCLONE_CONFIG_R2_REGION is required}"
: "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:?RCLONE_CONFIG_R2_ACCESS_KEY_ID is required}"
: "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:?RCLONE_CONFIG_R2_SECRET_ACCESS_KEY is required}"
: "${RCLONE_CONFIG_R2_NO_CHECK_BUCKET:?RCLONE_CONFIG_R2_NO_CHECK_BUCKET is required}"

TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DUMP_NAME="agileworks_erp_${TS}"
DUMP_DIR="/tmp/${DUMP_NAME}"
ARCHIVE="/tmp/${DUMP_NAME}.dir.tar.gz"
REMOTE_KEY="pg/${DUMP_NAME}.dir.tar.gz"

# Registered once the paths above are known, so it always has well-defined
# variables to act on. Runs on ANY exit and does not change the script's
# real exit status.
cleanup() {
  rm -rf "$DUMP_DIR" "$ARCHIVE" 2>/dev/null || true
}
trap cleanup 0

echo "Starting backup: ${DUMP_NAME}"

# 1. Dump — read-only, app_backup role. libpq picks up PGHOST/PGPORT/
#    PGDATABASE/PGUSER/PGPASSWORD from the environment automatically; no
#    connection string is ever built or passed as an argument.
pg_dump --format=directory --file="$DUMP_DIR" || fail "pg_dump exited non-zero"

# 2. Compress into one object (mirrors the shape of Render's own exports).
tar czf "$ARCHIVE" -C /tmp "$DUMP_NAME" || fail "tar compression failed"

# 3. Upload. rclone reads all R2 connection details from the
#    RCLONE_CONFIG_R2_* environment variables set on the Cron Job — never
#    referenced directly in this script, never on argv. -q keeps
#    stdout/stderr free of anything sensitive.
rclone copy -q "$ARCHIVE" "r2:${R2_BUCKET}/pg/" || fail "rclone upload failed"

# 4. Verify, deterministically. rclone lsjson filtered to the exact
#    filename, parsed with jq on the exact Name field — not a prefix guess
#    or a regex/sed scrape of raw JSON. --files-only excludes any
#    directory-shaped entries.
LISTING="$(rclone lsjson "r2:${R2_BUCKET}/pg" --files-only --include "${DUMP_NAME}.dir.tar.gz")" \
  || fail "rclone lsjson failed during verification"
REMOTE_SIZE="$(printf '%s' "$LISTING" \
  | jq -r --arg name "${DUMP_NAME}.dir.tar.gz" '[.[] | select(.Name == $name)][0].Size // "0"')"
case "$REMOTE_SIZE" in
  ''|0|*[!0-9]*)
    fail "upload verification failed: ${REMOTE_KEY} not found or has zero/invalid size in ${R2_BUCKET}"
    ;;
esac
echo "Upload verified: ${REMOTE_KEY} (${REMOTE_SIZE} bytes)"

# 5. Heartbeat — only reached after a fully verified backup. The URL is
#    passed to curl via a config file piped over stdin (-K -), never as a
#    command-line argument, so it never appears in `ps` output.
if ! printf 'url = "%s"\n' "$HEARTBEAT_URL" | curl -fsS --retry 3 -K - >/dev/null; then
  echo "BACKUP SUCCEEDED but heartbeat delivery failed (backup: ${REMOTE_KEY}, ${REMOTE_SIZE} bytes)." >&2
  echo "Check HEARTBEAT_URL and the Cron Job's network egress to the monitor — this is a monitoring/configuration issue, not a data-loss risk." >&2
  exit 1
fi

echo "Backup complete: ${REMOTE_KEY} (${REMOTE_SIZE} bytes), heartbeat delivered."
