# Archipelago — evolving ecosystems in communicating containers

Archipelago is an original agent-based evolutionary simulator, deliberately split across six
containers that have to talk to each other to work at all. Three **island** containers each run
their own predator-prey ecosystem on a grid, where prey evolve camouflage and speed and predators
evolve eyesight and guile, and each island periodically ships a wave of live individuals to every
other island; a **redis** container is the only channel between them, carrying migrants in transit,
live snapshots and control commands; a **collector** container drains per-generation statistics from
all three islands and writes the output files; and a **dashboard** container serves a web interface
on port 8080 that reads the same snapshots and lets you steer any island while it runs. The islands
communicate over the network through redis, and every container shares the `./output` folder as a
bind-mounted volume, so the two interaction mechanisms the assignment asks about — ports and shared
folders — are both load-bearing rather than decorative: cut redis and the islands stop exchanging
individuals; the collector produces nothing without the islands' statistics.

## How the containers communicate

Redis is the only channel. Every key is written by one container and read by another.

| Key                               | Written by         | Read by                | Carries                                     |
| --------------------------------- | ------------------ | ---------------------- | ------------------------------------------- |
| `migrants:<island>`               | a neighbour island | that island            | serialized individuals in transit           |
| `state:<island>`                  | island             | dashboard              | full snapshot of that island, 60 s TTL      |
| `stats:<island>`                  | island             | collector              | one row per generation                      |
| `control:<island>`, `cmd:<island>`| dashboard          | island                 | live parameters and one-shot interventions  |
| `done:<island>`, `done:collector` | island, collector  | collector, dashboard, redis | shutdown coordination                  |

The topology is a full mesh: each island exchanges individuals directly with every other one. An
individual that crosses is a real object with its genome — it lands in the destination population,
breeds there and passes its traits on, which is why immigration visibly changes the receiving
island's evolution.

## Prerequisites

- Docker ≥ 29.0 and Docker Compose ≥ 2.20 (the v2 `docker compose` subcommand)
- A free TCP port 8080 on the host, for the web interface
- Very little else: measured a few hundred generations into a run, all six containers together
  used about 120 MB of RAM and roughly a third of one CPU core. Both grow with the populations,
  so 1 GB of free memory is ample headroom
- No network access is needed at runtime: the image is built once and the interface loads no
  external assets

Both base images (`python:3.12-slim` and `redis:7-alpine`) are multi-arch, so **no `--platform`
flag is needed on Apple Silicon**. Built and verified natively on arm64 under macOS with Docker
29.7.2 and Compose v5.5.1. The whole application image is about 45 MB and its only third-party
dependency is the `redis` client.

## Build and run

```bash
# from the project root
make up
```

That builds the image, starts all six containers and opens the interface. **Nothing evolves yet.**
The islands seed their worlds, publish them so you can see the archipelago at rest, and wait. The
terminal tells you the same thing:

```
[dashboard] ------------------------------------------------------------
[dashboard]   The archipelago is seeded and standing by.
[dashboard]
[dashboard]   1. Open  http://localhost:8080
[dashboard]   2. Choose how many generations to run
[dashboard]   3. Press Start
[dashboard]
[dashboard]   Nothing evolves until you do. Output is written as it runs.
[dashboard] ------------------------------------------------------------
```

In the interface you pick a length — **400**, **600**, **1,000** generations or **no limit** — and
press *Start the run*. The islands begin together at generation one, so the charts show the whole
run rather than joining one already in progress, and when the ceiling is reached the stack writes
its files and shuts itself down on its own.

This is the point of the gate: nothing happens that you did not ask for, and you see the archipelago
before it moves rather than several hundred generations into it.

Plain compose behaves the same way, since the wait is the default — you just open the page yourself:

```bash
docker compose up --build
open http://localhost:8080          # macOS (xdg-open on Linux)
```

**A container cannot open a browser on the host**, which is why the `make` targets do it from the
host side: `scripts/open_when_ready.sh` polls the dashboard in the background and opens
<http://localhost:8080> the moment it answers. Compose itself is untouched — Ctrl-C still stops
everything, and a bounded run still returns by itself.

### Skipping the gate

If you already know how long you want and would rather not click anything:

```bash
make run EPOCHS=2000     # starts immediately, no waiting
make fast                # 300 generations, about 55 seconds end to end
```

Both set `START_MODE=auto`, which is also what you want for an unattended or scripted run.

### It never waits forever

An armed island that has seen **no viewer at all** within `VIEWER_TIMEOUT` seconds concludes that
nobody is coming, logs `nobody opened the interface, running headless`, and runs on `MAX_TICKS`
instead. Verified by starting the stack with no dashboard service at all: the islands wait, give up,
and write the same five output files. Once somebody *is* watching, the wait becomes unbounded on
purpose — a person is there to decide, and hurrying them is exactly what this avoids.

### Options

| Variable         | Default  | What it does                                                          |
| ---------------- | -------: | --------------------------------------------------------------------- |
| `START_MODE`     | `armed`  | `armed` waits to be started from the interface; `auto` begins at once  |
| `EPOCHS`         |   `2000` | Generations for `make run`. One epoch is one generation                |
| `MAX_TICKS`      |      `0` | The ceiling for `auto`, and the fallback if nobody opens the interface |
| `VIEWER_TIMEOUT` |    `180` | How long an armed island waits for a viewer before running headless    |
| `TICK_HZ`        |     `12` | Generations per second each island aims for                            |
| `LINGER_SECONDS` |    `120` | How long the dashboard stays up *after* a bounded run, so you can look |

`LINGER_SECONDS` is why a 400-generation run takes about three minutes rather than thirty seconds:
the simulation is over quickly and the rest is the interface waiting for you. Pass
`LINGER_SECONDS=15` for a run that packs up promptly.

With a ceiling the stack shuts itself down in order: the islands stop at that generation, the
collector writes the files and stops, the dashboard serves for another `LINGER_SECONDS`, and redis
— which has no reason of its own to stop — drains last, so the command returns with every service
at exit code 0. Choose *No limit* and nothing ever declares itself done: that run keeps going until
you stop it with Ctrl-C.

Stop and clean up:

```bash
make down          # stop the stack, keep the output files
make clean         # stop it and delete the generated output too
```

## Verification

### While the run is in progress

```bash
# the report, read from inside a container
docker compose exec dashboard cat /app/output/report.md

# the output files exist and are growing
docker compose exec dashboard ls -l /app/output

# the islands really are publishing into redis
docker compose exec redis redis-cli keys 'state:*'
docker compose exec redis redis-cli --raw get state:island-1 | head -c 300

# per-island progress
docker compose logs island-1 | tail -5
```

### After the run, from the host

```bash
cat output/report.md
head -3 output/results.csv
open output/populations.svg

# automated check: every island must have both sent and received individuals
make verify
```

`make verify` prints a row per island and passes only if all five output files exist and every
island both sent and received migrants:

```
island        ticks   prey   pred   sent   recv
island-1        400    941    241     96     90
island-2        400    682    210     96     93
island-3        400   1120    116     96     96

PASS: islands exchanged individuals and all output files are present
```

**This is the proof that the containers actually communicate.** The `Emigrants` and `Immigrants`
columns of `report.md` are non-zero for every island, and `migrants_sent` / `migrants_received` in
`results.csv` climb over the run. If the containers were not talking, both would stay at zero and
`make verify` would fail. Note that `redis-cli llen migrants:island-2` normally reads `0` — that is
the queue being drained instantly by its owner, not an absence of traffic; the cumulative counters
are the thing to read.

## What is produced

Everything lands in `./output` on the host, through a bind mount shared by every container.

| File              | Contents                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| `results.csv`     | One row per island per generation: populations, mean traits, migration counts |
| `report.md`       | Final state, mean traits per island, and between-island differentiation      |
| `populations.svg` | Populations by island — prey solid, predators dashed                          |
| `traits.svg`      | Mean prey guile (camouflage) per island, on a 0–1 scale                       |
| `migration.svg`   | Individuals whose lineage comes from another island                           |

The charts are written by hand as plain SVG, with no plotting library, which is why the image stays
small and the output stays diffable text.

## The web interface

<http://localhost:8080> while the stack is up. On a fresh stack it opens on the starting gate: the
three islands drawn at rest, and one card asking how long the run should be. Once you press start
it is out of the way for good.

After that, the sea fills the viewport: each island is a live
raster of its own grid — green is grass, ochre dots are prey, rust dots are predators, and a dot
ringed in blue is an individual that crossed the water. Marks moving between islands are real
migrations happening at that moment. A card per island on the right opens its parameters; a run
strip along the bottom charts every island against one shared scale.

You can change grass growth, predator lethality, mutation rate and migration cadence live, close a
strait to cut an island off, or trigger a drought or an epidemic, and watch the curves respond.
Every intervention leaves a mark on the run strip so the change that follows it has an explanation.
The interface is optional: the simulation and the output files do not depend on it, and the stack
produces `./output` whether or not anybody opens a browser.

## Reproducibility

Each island is seeded explicitly (`SEED` in `docker-compose.yml`: 11, 23, 37), and the simulation
engine is deterministic for a given seed — same seed, same run. Migration between containers is
asynchronous, however, so the exact interleaving of arrivals varies between runs and the whole
archipelago is therefore **not** bit-for-bit reproducible. The statistical behaviour is:
coexistence, cycles, occasional local extinction and rescue by immigration all recur across seeds.
The engine itself carries no clock and no randomness beyond its seeded generator, so a single
island replayed alone is exact; it is the crossing between containers that is not.

## Troubleshooting

**`docker compose up` does not return.** Either you chose *No limit* when you started the run, or
nobody ever opened the interface and the islands fell back to `MAX_TICKS`, which defaults to no
ceiling. Pick one of the numbered lengths instead, or pass `MAX_TICKS=2000`. Ctrl-C, or `make down`
from another terminal, stops an endless run at any time.

**Nothing is happening and the interface says "Ready when you are".** That is the design: the
islands are seeded and waiting for you to choose a length and press *Start the run*. If you would
rather skip the gate entirely, use `make run EPOCHS=2000` or set `START_MODE=auto`.

**The run started on its own, without me pressing anything.** Two ways that happens. A browser tab
left open on the dashboard from an earlier run keeps polling and counts as a viewer, which is
correct but easy to forget — close stale tabs. Or nobody opened the interface within
`VIEWER_TIMEOUT` seconds and the islands ran headless rather than wait forever.

**`./output` is empty.** The collector writes every 20 records (`FLUSH_EVERY`), so give it a few
seconds after start.
Then check the bind mount really is mounted: `docker compose exec collector ls -l /app/output`
should list the same files as `ls -l output` on the host. If the container sees files and the host
does not, the mount did not take — on Docker Desktop, confirm the project folder is inside a shared
path in Settings → Resources → File sharing.

**Files in `./output` are owned by root (Linux hosts).** The containers run as root so the bind
mount works without extra configuration. Take ownership with
`sudo chown -R "$USER" output`. On macOS this does not arise: Docker Desktop maps ownership to you.

**Port 8080 is already taken.** Change the published port in `docker-compose.yml` under the
`dashboard` service, for example `"8081:8080"`, then open the new port. Only the host side changes.

**Platform or architecture warnings on Apple Silicon.** There should be none: both base images
publish arm64 manifests and the stack builds and runs natively on M-series Macs, with no
`--platform` flag. If you have forced `DOCKER_DEFAULT_PLATFORM=linux/amd64` in your environment,
unset it — that would run the whole stack under emulation and make it far slower. The project has
not been tested on amd64, so no claim is made about it.

**The interface says it is waiting for the islands.** They have not published their first snapshot
yet. It clears within a couple of seconds of start. If it persists, check redis is healthy with
`docker compose ps` and look at `docker compose logs island-1`.

**The browser did not open by itself.** Only the `make` targets open it, and only if `open` (macOS)
or `xdg-open` (Linux) exists. Open <http://localhost:8080> manually; nothing else is affected.

**The simulation runs slower than 12 generations per second.** Populations of well over a thousand
individuals cost more than the 83 ms per-generation budget, so the islands fall slightly behind the
target rate. This is expected and harmless; lower `TICK_HZ` if you want a gentler load.

**A population goes extinct.** That is a legitimate ecological outcome, not a crash. The island
keeps running with whatever survives, and immigration from its neighbours can repopulate it — the
rescue effect is one of the phenomena the project exists to show.

## Project layout

```
Dockerfile              one image for all five application services
docker-compose.yml      redis + 3 islands + collector + dashboard
Makefile                run / up / fast / verify / test / down / clean
requirements.txt        redis==5.2.1 — the only runtime dependency
src/archipelago/        engine, island, collector, dashboard, plots, and the web interface
scripts/                verify_output.py, open_when_ready.sh
tests/                  15 unit tests for the simulation engine
output/                 bind-mounted target for the generated files
```

## Tests

```bash
make test          # 15 unit tests, no Docker and no redis needed
```

They cover the engine directly: that a fixed seed reproduces a run exactly and a different one
diverges, that predators starve without prey and grass regrows without grazers, that selection
actually moves the traits, that a migrant survives serialization with its genome intact and is
counted as a newcomer while its offspring are not, that a traveller turned back at a closed strait
is not counted as an immigrant, and that a restart begins a new numbered run while keeping its
parameters.

## Credits

Original work. The predator-prey setup is inspired by the classic NetLogo Wolf Sheep Predation
model; the evolutionary layer, the migration mesh, the container split and the interface are this
project's own. Standard library throughout, plus the `redis` client.
