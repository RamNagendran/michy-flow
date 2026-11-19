#!/bin/sh
# Daily pg_dump at 02:00 IST (20:30 UTC). Bills live in the database, so this covers them too.
set -eu
while :; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) 20:30" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))

  file="/backups/michy_flow_$(date -u +%Y%m%d_%H%M).dump"
  if pg_dump -Fc -Z 6 -f "$file.part"; then
    mv "$file.part" "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "backup FAILED" >&2
  fi
  find /backups -name 'michy_flow_*.dump' -mtime +"$KEEP_DAYS" -delete
done
