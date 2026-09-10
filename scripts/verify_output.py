#!/usr/bin/env python3
"""Check that a completed run really produced cross-container evidence.

Reads ./output/results.csv and asserts that every island both sent and received
migrants. If the containers had not communicated, those counters would be zero.
Exits non-zero on failure so it can gate CI or `make verify`.
"""

from __future__ import annotations

import csv
import pathlib
import sys

OUTPUT = pathlib.Path(__file__).resolve().parent.parent / "output"


def main() -> int:
    path = OUTPUT / "results.csv"
    if not path.exists():
        print(f"FAIL: {path} not found — run `make up` first")
        return 1

    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        print("FAIL: results.csv has no data rows")
        return 1

    last: dict[str, dict] = {}
    for row in rows:
        last[row["island"]] = row

    if len(last) < 2:
        print(f"FAIL: expected several islands, found {list(last)}")
        return 1

    ok = True
    print(f"{'island':<12} {'ticks':>6} {'prey':>6} {'pred':>6} {'sent':>6} {'recv':>6}")
    for name, row in sorted(last.items()):
        sent, received = int(row["migrants_sent"]), int(row["migrants_received"])
        print(
            f"{name:<12} {row['tick']:>6} {row['prey']:>6} {row['predators']:>6} "
            f"{sent:>6} {received:>6}"
        )
        if sent == 0:
            print(f"  FAIL: {name} never sent a migrant")
            ok = False
        if received == 0:
            print(f"  FAIL: {name} never received a migrant")
            ok = False

    for name in ("report.md", "populations.svg", "traits.svg", "migration.svg"):
        target = OUTPUT / name
        if not target.exists() or target.stat().st_size == 0:
            print(f"  FAIL: {name} missing or empty")
            ok = False

    print("\nPASS: islands exchanged individuals and all output files are present" if ok else "\nFAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
