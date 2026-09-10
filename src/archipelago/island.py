"""Island service.

One container per island. Runs its own ecosystem, ships migrants to its neighbour
through a Redis list, admits the ones addressed to it, publishes a snapshot for
the dashboard and a statistics row for the collector.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import deque

import redis

from .engine import PRED, PREY, World

NAME = os.environ.get("ISLAND_NAME", "island")
# Full mesh, not a ring: every island talks to every other island named in ISLANDS.
ALL_ISLANDS = [s.strip() for s in os.environ.get("ISLANDS", "").split(",") if s.strip()]
NEIGHBORS = [i for i in ALL_ISLANDS if i != NAME]
SEED = int(os.environ.get("SEED", "1"))
# 0 (the default) means no ceiling: the island runs like a live field station that a
# person switches off, rather than a batch job with a fixed generation budget.
MAX_TICKS = int(os.environ.get("MAX_TICKS", "0"))
TICK_HZ = float(os.environ.get("TICK_HZ", "12"))

# An armed island seeds its world, publishes it, and then waits to be started from the
# interface, which is also where the person chooses how many generations to run. The
# alternative is `START_MODE=auto`, which begins immediately on the env budget and is
# what a headless run wants.
ARMED = os.environ.get("START_MODE", "armed").strip().lower() != "auto"
# How long an armed island waits before concluding that nobody is coming. It only
# applies while no viewer has ever appeared: once somebody is watching, the island
# waits as long as they need to choose, because a person is there to decide.
VIEWER_TIMEOUT = float(os.environ.get("VIEWER_TIMEOUT", "180"))

# `isolated` is a two-bit gate on this island's traffic, not a boolean, because
# closing a strait is really two separate questions and a person watching the
# archipelago will want to ask them one at a time: what happens to this island if it
# stops exporting its genes, and what happens if it stops receiving anyone else's.
# Value 3 — both bits — is the old "closed" and is what the Marooned scenario sets.
NO_DEPARTURES = 1   # this island sends nobody
NO_ARRIVALS = 2     # this island admits nobody

# How long an event stays visible in the published snapshot.
#
# `state:<island>` is a last-value key: this island overwrites it TICK_HZ times a
# second while the browser reads it about three times a second, so an event that
# appeared in exactly one snapshot would be missed roughly two times in three. It is
# therefore repeated for a few seconds and carries the tick it happened on, which is
# what lets the dashboard place its mark correctly and ignore the repeats.
EVENT_TTL_TICKS = max(1, int(float(os.environ.get("TICK_HZ", "12")) * 3))

# Parameters the dashboard is allowed to change while the simulation runs. Every one
# of them is read fresh by `World.step` (or by `migrate`) at the top of each
# generation, so a slider move lands on the very next tick with no restart.
LIVE_KEYS = {
    "grass_rate": float,
    "grass_energy": float,
    "lethality": float,
    "pred_gain": float,
    "prey_repro": float,
    "pred_repro": float,
    "max_age": int,
    "carrying_capacity": int,
    "mutation": float,
    "migrants_per_wave": int,
    "migration_interval": int,
    "paused": int,
    "isolated": int,
}


def base_params() -> dict:
    return {
        "width": int(os.environ.get("WIDTH", "64")),
        "height": int(os.environ.get("HEIGHT", "40")),
        "grass_rate": float(os.environ.get("GRASS_RATE", "0.05")),
        "grass_energy": float(os.environ.get("GRASS_ENERGY", "4.2")),
        "mutation": float(os.environ.get("MUTATION", "0.05")),
        "lethality": float(os.environ.get("LETHALITY", "1.0")),
        "pred_gain": float(os.environ.get("PRED_GAIN", "6.0")),
        # Explicit rather than left to the engine defaults, so the values the dashboard
        # reads back are the ones actually in force. Tuned: see CLAUDE.md before moving.
        "prey_repro": float(os.environ.get("PREY_REPRO", "15.0")),
        "pred_repro": float(os.environ.get("PRED_REPRO", "75.0")),
        "max_age": int(os.environ.get("MAX_AGE", "260")),
        "carrying_capacity": int(os.environ.get("CARRYING_CAPACITY", "2200")),
        "initial_prey": int(os.environ.get("INITIAL_PREY", "260")),
        "initial_predators": int(os.environ.get("INITIAL_PREDATORS", "14")),
        "migrants_per_wave": int(os.environ.get("MIGRANTS_PER_WAVE", "6")),
        "migration_interval": int(os.environ.get("MIGRATION_INTERVAL", "25")),
        "paused": 0,
        "isolated": 0,
    }


# Captured once at import, before the dashboard can touch anything: the snapshot
# ships these so the panel can offer "restore this island's defaults" and show how
# far a slider has been moved from where the container started.
DEFAULTS = {k: v for k, v in base_params().items() if k in LIVE_KEYS}


def connect() -> redis.Redis:
    host = os.environ.get("REDIS_HOST", "redis")
    client = redis.Redis(host=host, port=int(os.environ.get("REDIS_PORT", "6379")), decode_responses=True)
    for attempt in range(60):
        try:
            client.ping()
            print(f"[{NAME}] connected to redis", flush=True)
            return client
        except redis.exceptions.ConnectionError:
            time.sleep(1)
    raise SystemExit(f"[{NAME}] redis unreachable at {host}")


def publish(client: redis.Redis, world: World, events: deque, with_stats: bool = True) -> None:
    """Put this island where the dashboard and the collector can read it.

    `with_stats` is off before the run begins: the collector writes one row per
    generation and generation zero has not happened yet, so an armed island refreshes
    its snapshot without inventing a row for it.
    """
    snapshot = world.snapshot()
    snapshot["events"] = list(events)
    snapshot["controls"] = {key: world.params.get(key) for key in LIVE_KEYS}
    snapshot["defaults"] = DEFAULTS
    snapshot["neighbors"] = NEIGHBORS

    pipe = client.pipeline()
    pipe.set(f"state:{NAME}", json.dumps(snapshot), ex=60)
    if with_stats:
        pipe.rpush(f"stats:{NAME}", json.dumps(world.stats()))
    pipe.execute()


def wait_for_start(client: redis.Redis, refresh) -> int:
    """Wait to be started from the interface, and return the generation budget chosen.

    An island that begins evolving the moment its container does has already run for
    hundreds of generations by the time a browser finishes loading, and the page can
    only chart what it sees, so that beginning is not late — it is gone. Worse, the
    person never chose it. Armed, the island seeds its world, publishes it so the
    interface can draw the archipelago at rest, and waits for someone to press start
    and say how long the run should be.

    The wait is unbounded *only while somebody is watching*, because then a person is
    there to decide and hurrying them is the whole thing this avoids. If no viewer has
    appeared within VIEWER_TIMEOUT the island concludes nobody is coming and runs on
    the environment's budget instead, so a headless `docker compose up` still produces
    ./output with no browser involved.

    Returns the ceiling in generations; 0 means no ceiling.
    """
    if not ARMED:
        return MAX_TICKS
    print(f"[{NAME}] ready and waiting to be started from the interface", flush=True)
    deadline = time.time() + VIEWER_TIMEOUT
    told = False
    beats = 0
    while True:
        # `state:<island>` expires after 60 s and a person choosing a run length can
        # easily take longer than that, so the snapshot is kept warm while we wait.
        # Without this the interface would go back to "waiting for the islands" while
        # the person is still looking at it.
        beats += 1
        if beats % 20 == 0:
            refresh()
        go = client.get("run:go")
        if go is not None:
            budget = max(0, int(go))
            shape = "no ceiling" if budget <= 0 else f"{budget} generations"
            print(f"[{NAME}] started from the interface: {shape}", flush=True)
            return budget
        if client.get("viewer:seen") == "1":
            if not told:
                print(f"[{NAME}] somebody is watching; waiting for them to press start",
                      flush=True)
                told = True
        elif time.time() > deadline:
            shape = "no ceiling" if MAX_TICKS <= 0 else f"{MAX_TICKS} generations"
            print(f"[{NAME}] nobody opened the interface within {VIEWER_TIMEOUT:.0f}s, "
                  f"running headless: {shape}", flush=True)
            return MAX_TICKS
        time.sleep(0.25)


def apply_controls(client: redis.Redis, world: World) -> None:
    """Read parameters set from the dashboard and apply them to the next generation."""
    overrides = client.hgetall(f"control:{NAME}")
    for key, cast in LIVE_KEYS.items():
        if key in overrides:
            try:
                world.params[key] = cast(float(overrides[key]))
            except (TypeError, ValueError):
                continue


def apply_commands(client: redis.Redis, world: World) -> None:
    """Run one-shot events: introduce individuals, drought, epidemic."""
    while True:
        raw = client.rpop(f"cmd:{NAME}")
        if raw is None:
            return
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError:
            continue
        op = cmd.get("op")
        if op == "seed":
            world.seed_agents(PRED if cmd.get("species") == "predators" else PREY, int(cmd.get("count", 10)))
        elif op == "cull":
            world.cull(PRED if cmd.get("species") == "predators" else PREY, float(cmd.get("fraction", 0.4)))
        elif op == "reset":
            # The queue this island has already published belongs to the run that is
            # ending. It is left alone: every row carries its run number, so the
            # collector keeps both and can tell them apart.
            world.reset()
            print(f"[{NAME}] reset: starting run {world.run}", flush=True)
        elif op == "drought":
            for row in world.grass:
                for i in range(len(row)):
                    row[i] *= 0.15
            world.events.append("drought")


def migrate(client: redis.Redis, world: World) -> None:
    if not NEIGHBORS or int(world.params.get("isolated", 0)) & NO_DEPARTURES:
        return
    wave = int(world.params.get("migrants_per_wave", 6))
    if wave <= 0:
        return
    # Round-robin the wave across every other island, so the archipelago is a full
    # mesh: total emigration stays the same as a single-neighbour ring, but genes now
    # reach every island directly instead of only travelling one hop at a time.
    for i, traveller in enumerate(world.take_emigrants(wave)):
        target = NEIGHBORS[i % len(NEIGHBORS)]
        traveller["from"] = NAME
        client.lpush(f"migrants:{target}", json.dumps(traveller))
    for neighbor in NEIGHBORS:
        client.ltrim(f"migrants:{neighbor}", 0, 199)


def receive(client: redis.Redis, world: World) -> None:
    # Refusing arrivals has to be enforced here, because a neighbour has no way of
    # knowing this island has shut its door and keeps pushing travellers at it.
    refusing = bool(int(world.params.get("isolated", 0)) & NO_ARRIVALS)
    for _ in range(40):
        raw = client.rpop(f"migrants:{NAME}")
        if raw is None:
            return
        try:
            traveller = json.loads(raw)
        except json.JSONDecodeError:
            continue

        if refusing:
            # Turned back at the shore rather than drowned: the traveller sails home,
            # where it counts as a resident returning and not as an immigrant. The
            # `returning` flag also terminates the bounce — an individual whose own
            # island has meanwhile shut its door too is lost at sea rather than
            # volleyed between two closed shores forever.
            home = traveller.get("from")
            if home and home != NAME and not traveller.get("returning"):
                traveller["returning"] = 1
                client.lpush(f"migrants:{home}", json.dumps(traveller))
            continue

        try:
            world.admit(traveller)
        except KeyError:
            continue


def main() -> int:
    client = connect()
    world = World(NAME, base_params(), seed=SEED)
    client.delete(f"migrants:{NAME}", f"stats:{NAME}", f"cmd:{NAME}")
    client.set(f"done:{NAME}", 0)
    recent_events: deque[dict] = deque()
    period = 1.0 / TICK_HZ if TICK_HZ > 0 else 0.0
    print(f"[{NAME}] seeded, neighbours={NEIGHBORS}, seed={SEED}", flush=True)

    # Publish the world before it moves, so the interface can draw the archipelago at
    # rest and the person can see what it is they are about to start.
    keep_warm = lambda: publish(client, world, recent_events, with_stats=False)
    keep_warm()
    ceiling = wait_for_start(client, keep_warm)

    while ceiling <= 0 or world.tick < ceiling:
        started = time.time()
        apply_controls(client, world)
        apply_commands(client, world)

        if not world.params.get("paused"):
            world.step()
            receive(client, world)
            cadence = max(1, int(world.params.get("migration_interval", 25)))
            if world.tick % cadence == 0:
                migrate(client, world)

        # The snapshot carries the live parameters and the mesh topology too, so the
        # dashboard can show the values this island runs with and draw every sea lane.
        # A restart sends the clock back to zero, so the log of the run that just
        # ended has to go with it: its ticks no longer name anything.
        if recent_events and recent_events[-1]["tick"] > world.tick:
            recent_events.clear()
        for text in world.drain_events():
            recent_events.append({"tick": world.tick, "text": text})
        while recent_events and world.tick - recent_events[0]["tick"] > EVENT_TTL_TICKS:
            recent_events.popleft()

        publish(client, world, recent_events)

        if world.tick % 250 == 0:
            s = world.stats()
            print(
                f"[{NAME}] t={s['tick']} prey={s['prey']} predators={s['predators']} "
                f"grass={s['grass']} foreign-lineage={s['foreign_prey'] + s['foreign_predators']}",
                flush=True,
            )

        elapsed = time.time() - started
        if period > elapsed:
            time.sleep(period - elapsed)

    client.set(f"done:{NAME}", 1)
    print(f"[{NAME}] run finished at t={world.tick}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
