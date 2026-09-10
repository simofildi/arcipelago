#!/usr/bin/env bash
# Runs the whole system locally without Docker: one process per service, exactly
# like the compose stack. Development helper, not part of the deliverable.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-/tmp/archipelago-out}
rm -rf "$OUT"; mkdir -p "$OUT"

redis-server --port 6399 --save "" --appendonly no --daemonize yes
sleep 1

export REDIS_HOST=127.0.0.1 REDIS_PORT=6399 ISLANDS=island-1,island-2,island-3
export MAX_TICKS=${MAX_TICKS:-400} TICK_HZ=${TICK_HZ:-40}
export MIGRATION_INTERVAL=${MIGRATION_INTERVAL:-25} PYTHONPATH=src

OUTPUT_DIR="$OUT" python3 -m archipelago.collector & C=$!
PORT=8099 LINGER_SECONDS=2 python3 -m archipelago.dashboard & D=$!
ISLAND_NAME=island-1 NEIGHBOR=island-2 SEED=11 GRASS_RATE=0.065 LETHALITY=0.8 python3 -m archipelago.island & A=$!
ISLAND_NAME=island-2 NEIGHBOR=island-3 SEED=23 GRASS_RATE=0.035 LETHALITY=1.3 python3 -m archipelago.island & B=$!
ISLAND_NAME=island-3 NEIGHBOR=island-1 SEED=37 GRASS_RATE=0.05  LETHALITY=1.0 MUTATION=0.10 python3 -m archipelago.island & E=$!
wait $A $B $E
wait $C || true
kill $D 2>/dev/null || true
echo "--- output in $OUT ---"; ls -l "$OUT"
