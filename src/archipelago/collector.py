"""Collector.

Drains the statistics queues published by the islands, keeps the full time series
and writes the output files to the shared volume: one CSV, three SVG charts and a
human-readable report.
"""

from __future__ import annotations

import csv
import json
import os
import statistics
import sys
import time

import redis

from .plots import line_chart

ISLANDS = [s.strip() for s in os.environ.get("ISLANDS", "island-1,island-2,island-3").split(",") if s.strip()]
OUTPUT = os.environ.get("OUTPUT_DIR", "/app/output")
FLUSH_EVERY = int(os.environ.get("FLUSH_EVERY", "20"))

FIELDS = [
    "island", "run", "tick", "prey", "predators", "grass",
    "migrants_sent", "migrants_received", "migrants_returned", "births",
    "deaths_starved", "deaths_predated", "deaths_old",
    "foreign_prey", "foreign_predators", "immigrants_alive",
    "prey_speed", "prey_vision", "prey_efficiency", "prey_guile",
    "pred_speed", "pred_vision", "pred_efficiency", "pred_guile",
]


def connect() -> redis.Redis:
    host = os.environ.get("REDIS_HOST", "redis")
    client = redis.Redis(host=host, port=int(os.environ.get("REDIS_PORT", "6379")), decode_responses=True)
    for _ in range(60):
        try:
            client.ping()
            return client
        except redis.exceptions.ConnectionError:
            time.sleep(1)
    raise SystemExit("[collector] redis unreachable")


def drain(client: redis.Redis, history: dict[str, list[dict]]) -> int:
    collected = 0
    for island in ISLANDS:
        key = f"stats:{island}"
        while True:
            raw = client.lpop(key)
            if raw is None:
                break
            try:
                history[island].append(json.loads(raw))
                collected += 1
            except json.JSONDecodeError:
                continue
    return collected


def write_csv(history: dict[str, list[dict]]) -> None:
    path = os.path.join(OUTPUT, "results.csv")
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        for island in ISLANDS:
            for row in history[island]:
                writer.writerow(row)


def latest_run(rows: list[dict]) -> list[dict]:
    """Only the run in progress.

    The CSV keeps every row of every run, but a chart cannot: after a reset the
    ticks start again at 1, and plotting both runs on one generation axis would fold
    the new one back over the old and read as a collapse that never happened.
    """
    if not rows:
        return rows
    current = max(int(r.get("run", 1)) for r in rows)
    return [r for r in rows if int(r.get("run", 1)) == current]


def write_charts(history: dict[str, list[dict]]) -> None:
    populations, traits, flow = [], [], []
    for island in ISLANDS:
        rows = latest_run(history[island])
        if not rows:
            continue
        populations.append((f"{island} · prey", [(r["tick"], r["prey"]) for r in rows]))
        populations.append((f"{island} · predators", [(r["tick"], r["predators"]) for r in rows]))
        traits.append((f"{island} · prey guile", [(r["tick"], r["prey_guile"]) for r in rows]))
        flow.append((f"{island} · foreign lineage", [(r["tick"], r["foreign_prey"] + r["foreign_predators"]) for r in rows]))

    dashed = {name for name, _ in populations if "predators" in name}
    charts = {
        "populations.svg": line_chart(
            "Populations by island", populations, y_label="individuals", dashed=dashed
        ),
        "traits.svg": line_chart(
            "Mean prey guile (camouflage)", traits, y_label="trait value 0–1"
        ),
        "migration.svg": line_chart(
            "Individuals whose lineage comes from another island", flow, y_label="individuals"
        ),
    }
    for name, svg in charts.items():
        with open(os.path.join(OUTPUT, name), "w", encoding="utf-8") as handle:
            handle.write(svg)


def divergence(history: dict[str, list[dict]]) -> float:
    """How far the islands have diverged: spread of the final mean trait values."""
    finals = [latest_run(history[i])[-1] for i in ISLANDS if history[i]]
    if len(finals) < 2:
        return 0.0
    spreads = []
    for trait in ("prey_speed", "prey_vision", "prey_efficiency", "prey_guile"):
        spreads.append(statistics.pstdev([row[trait] for row in finals]))
    return sum(spreads) / len(spreads)


def write_report(history: dict[str, list[dict]]) -> None:
    lines = [
        "# Archipelago — simulation report",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M:%S')} · {len(ISLANDS)} islands in a full mesh: "
        "every island exchanges individuals directly with every other one.",
        "",
        "## Final state",
        "",
        "| Island | Tick | Prey | Predators | Grass | Emigrants | Immigrants | Landed alive | Foreign lineage |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for island in ISLANDS:
        rows = latest_run(history[island])
        if not rows:
            lines.append(f"| {island} | — | — | — | — | — | — | — | — |")
            continue
        r = rows[-1]
        lines.append(
            f"| {island} | {r['tick']} | {r['prey']} | {r['predators']} | {r['grass']:.3f} | "
            f"{r['migrants_sent']} | {r['migrants_received']} | {r['immigrants_alive']} | "
            f"{r['foreign_prey'] + r['foreign_predators']} |"
        )

    lines += ["", "## Final mean traits", "", "| Island | Species | Speed | Vision | Efficiency | Guile |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for island in ISLANDS:
        rows = latest_run(history[island])
        if not rows:
            continue
        r = rows[-1]
        lines.append(
            f"| {island} | prey | {r['prey_speed']:.3f} | {r['prey_vision']:.3f} | "
            f"{r['prey_efficiency']:.3f} | {r['prey_guile']:.3f} |"
        )
        lines.append(
            f"| {island} | predators | {r['pred_speed']:.3f} | {r['pred_vision']:.3f} | "
            f"{r['pred_efficiency']:.3f} | {r['pred_guile']:.3f} |"
        )

    runs = max((int(r.get("run", 1)) for rows in history.values() for r in rows), default=1)
    if runs > 1:
        lines += [
            "",
            "## Restarts",
            "",
            f"The simulation was restarted from the dashboard, so this is run **{runs}**. The tables",
            "above and the charts describe that run only. `results.csv` keeps every row of every run",
            "and carries a `run` column, so the earlier ones are still there to be read.",
        ]

    div = divergence(history)
    lines += [
        "",
        "## Between-island differentiation",
        "",
        f"Mean spread between islands across the four prey traits: **{div:.4f}**.",
        "",
        "A high value means the local environments pushed the populations in different directions;",
        "a low value means gene flow across the sea homogenised them. Lower `MIGRANTS_PER_WAVE`",
        "in the compose file, or close a strait from the dashboard, and the value climbs.",
        "",
        "## Files produced",
        "",
        "- `results.csv` — one row per island per generation",
        "- `populations.svg` — prey (solid) and predators (dashed)",
        "- `traits.svg` — how prey camouflage evolves",
        "- `migration.svg` — how much of each island descends from migrants",
        "",
    ]
    with open(os.path.join(OUTPUT, "report.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def flush(history: dict[str, list[dict]]) -> None:
    write_csv(history)
    write_charts(history)
    write_report(history)


def main() -> int:
    os.makedirs(OUTPUT, exist_ok=True)
    client = connect()
    client.set("done:collector", 0)
    history: dict[str, list[dict]] = {island: [] for island in ISLANDS}
    print(f"[collector] listening on {ISLANDS}, writing to {OUTPUT}", flush=True)

    idle = 0
    since_flush = 0
    while True:
        got = drain(client, history)
        since_flush += got
        if since_flush >= FLUSH_EVERY:
            flush(history)
            since_flush = 0

        islands_done = all(client.get(f"done:{i}") == "1" for i in ISLANDS)
        if got == 0:
            idle += 1
            if islands_done and idle > 3:
                break
            time.sleep(0.5)
        else:
            idle = 0

    flush(history)
    total = sum(len(rows) for rows in history.values())
    client.set("done:collector", 1)
    print(f"[collector] wrote {total} records. Output ready in {OUTPUT}", flush=True)
    for name in ("results.csv", "report.md", "populations.svg", "traits.svg", "migration.svg"):
        print(f"[collector]   - {name}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
