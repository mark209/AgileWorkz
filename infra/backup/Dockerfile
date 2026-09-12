# AgileWorks HVAC ERP — off-platform PostgreSQL backup job (Phase 7 P0).
#
# Runs as a Render Cron Job. postgres:18-alpine matches production's
# PostgreSQL 18 exactly — pg_dump must come from tooling matching (or newer
# than) the target for a clean restore, per the C1-C3 restore test already
# performed.
#   - rclone: uploads the resulting archive to Cloudflare R2.
#   - curl: pings the external dead-man's-switch heartbeat monitor.
#   - jq: deterministically parses rclone's JSON listing to verify the
#     uploaded object's exact name and size, instead of brittle text/regex
#     parsing of JSON.
# No other tools, no credentials, no application code baked into the
# image. See backup.sh for the logic and README.md for the required
# environment variables and restore procedure.
FROM postgres:18-alpine

RUN apk add --no-cache rclone curl jq

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

CMD ["/usr/local/bin/backup.sh"]
