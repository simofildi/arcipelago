#!/usr/bin/env sh
# Opens the dashboard in the host's browser as soon as it answers.
#
# A container cannot open a browser on the host, so this runs host-side, in the
# background, while `docker compose up` keeps the foreground. That matters: compose
# stays exactly as it was, so Ctrl-C still stops the whole stack and a bounded run
# still returns on its own. This script only watches and opens.
#
# It gives up rather than waiting forever, because a stack that failed to start
# should not leave a browser tab arriving minutes later out of nowhere.

URL="${1:-http://localhost:8080}"
TIMEOUT="${2:-90}"

if command -v open >/dev/null 2>&1; then          # macOS
  OPENER="open"
elif command -v xdg-open >/dev/null 2>&1; then    # Linux desktops
  OPENER="xdg-open"
else
  exit 0                                          # nothing to open with: stay quiet
fi

i=0
while [ "$i" -lt "$TIMEOUT" ]; do
  if curl -sf -o /dev/null "$URL" 2>/dev/null; then
    "$OPENER" "$URL" >/dev/null 2>&1
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
exit 0
