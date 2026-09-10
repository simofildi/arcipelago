"""Simulation engine for a single island.

Standard library only: no external dependency, so the image stays small and a run
is deterministic for a given seed.

The world is a toroidal grid of cells holding regrowing grass. Two species live
on it: prey that graze and predators that hunt. Every individual carries a genome
of four continuous traits that mutates on reproduction, so the population adapts
to the local environment of its island.
"""

from __future__ import annotations

import math
import random

PREY = 0
PRED = 1

TRAITS = ("speed", "vision", "efficiency", "guile")


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return low if value < low else high if value > high else value


class Agent:
    """One individual. __slots__ keeps memory flat with thousands of agents."""

    __slots__ = ("uid", "species", "x", "y", "energy", "age", "genome", "origin", "born_tick", "newcomer")

    def __init__(self, uid, species, x, y, energy, genome, origin, born_tick=0, newcomer=False):
        self.uid = uid
        self.species = species
        self.x = x
        self.y = y
        self.energy = energy
        self.age = 0
        self.genome = genome
        self.origin = origin
        self.born_tick = born_tick
        # True only for individuals that crossed the sea themselves. Offspring are born
        # native but keep `origin` as a lineage marker.
        self.newcomer = newcomer

    # -- derived traits ---------------------------------------------------
    @property
    def steps(self) -> int:
        return 1 + int(self.genome["speed"] * 2.99)

    @property
    def sight(self) -> int:
        return 1 + int(self.genome["vision"] * 5.0)

    def upkeep(self) -> float:
        g = self.genome
        base = 0.28 if self.species == PREY else 0.55
        move = (0.55 if self.species == PREY else 0.75) * g["speed"] ** 2
        eyes = 0.14 * g["vision"]
        wits = (0.30 if self.species == PREY else 0.22) * g["guile"] ** 2
        thrift = 1.0 - 0.40 * g["efficiency"]
        return (base + move + eyes + wits) * thrift

    def to_dict(self) -> dict:
        return {
            "uid": self.uid,
            "species": self.species,
            "energy": round(self.energy, 2),
            "age": self.age,
            "genome": {k: round(v, 4) for k, v in self.genome.items()},
            "origin": self.origin,
        }

    @staticmethod
    def from_dict(data: dict, uid: int, x: int, y: int) -> "Agent":
        agent = Agent(uid, data["species"], x, y, data["energy"], dict(data["genome"]),
                      data["origin"], newcomer=True)
        agent.age = data.get("age", 0)
        return agent


def random_genome(rng: random.Random, species: int) -> dict:
    if species == PREY:
        return {
            "speed": rng.uniform(0.25, 0.65),
            "vision": rng.uniform(0.15, 0.55),
            "efficiency": rng.uniform(0.25, 0.65),
            "guile": rng.uniform(0.20, 0.60),
        }
    return {
        "speed": rng.uniform(0.40, 0.80),
        "vision": rng.uniform(0.35, 0.75),
        "efficiency": rng.uniform(0.25, 0.65),
        "guile": rng.uniform(0.30, 0.70),
    }


class World:
    """A single island: grid, populations, and one simulation tick."""

    def __init__(self, name: str, params: dict, seed: int = 0):  # noqa: D107
        self.name = name
        self.params = params
        self.seed = seed
        self.width = int(params.get("width", 64))
        self.height = int(params.get("height", 40))
        # Runs are numbered from 1 and the number travels with every statistics row,
        # so a reset starts a fresh series the collector can tell apart instead of
        # folding new ticks back over the old ones.
        self.run = 1
        self.occupancy: dict[tuple[int, int], list[Agent]] = {}
        self._populate()

    def _populate(self) -> None:
        """Bring the island back to generation zero. Parameters are left alone."""
        self.rng = random.Random(self.seed + self.run - 1)
        self.tick = 0
        self._next_uid = 1

        self.grass = [[self.rng.uniform(0.4, 1.0) for _ in range(self.width)] for _ in range(self.height)]
        self.agents: list[Agent] = []
        self.occupancy = {}

        self.migrants_sent = 0
        self.migrants_received = 0
        self.migrants_returned = 0
        self.births = 0
        self.deaths_starved = 0
        self.deaths_predated = 0
        self.deaths_old = 0
        self.events: list[str] = []

        for _ in range(int(self.params.get("initial_prey", 260))):
            self._spawn(PREY, energy=self.rng.uniform(8, 16))
        for _ in range(int(self.params.get("initial_predators", 14))):
            self._spawn(PRED, energy=self.rng.uniform(30, 45))

    def reset(self) -> None:
        """Start the island over: new populations, clock back to zero.

        Whatever the person has set on the sliders stays set — restarting a run and
        undoing your configuration are two different things, and the panel offers
        the second separately. The seed is advanced by the run number so a restart
        is a genuinely new draw rather than a replay of the same one.
        """
        self.run += 1
        self._populate()
        self.events.append(f"reset:{self.run}")

    # -- helpers ----------------------------------------------------------
    def _uid(self) -> int:
        self._next_uid += 1
        return self._next_uid

    def _spawn(self, species: int, energy: float, genome: dict | None = None) -> Agent:
        agent = Agent(
            self._uid(),
            species,
            self.rng.randrange(self.width),
            self.rng.randrange(self.height),
            energy,
            genome or random_genome(self.rng, species),
            self.name,
            self.tick,
        )
        self.agents.append(agent)
        return agent

    def _mutate(self, genome: dict) -> dict:
        sigma = float(self.params.get("mutation", 0.05))
        return {k: _clamp(v + self.rng.gauss(0.0, sigma)) for k, v in genome.items()}

    def _wrap(self, x: int, y: int) -> tuple[int, int]:
        return x % self.width, y % self.height

    def _build_occupancy(self) -> None:
        self.occupancy = {}
        for agent in self.agents:
            self.occupancy.setdefault((agent.x, agent.y), []).append(agent)

    def _nearest_prey(self, hunter: Agent) -> Agent | None:
        best, best_d = None, None
        reach = hunter.sight
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                cell = self._wrap(hunter.x + dx, hunter.y + dy)
                for other in self.occupancy.get(cell, ()):
                    if other.species != PREY:
                        continue
                    # prey camouflage shrinks the radius at which a predator detects it
                    detect = reach * (1.0 - 0.55 * other.genome["guile"])
                    d = math.hypot(dx, dy)
                    if d <= detect and (best_d is None or d < best_d):
                        best, best_d = other, d
        return best

    def _best_grass(self, grazer: Agent) -> tuple[int, int] | None:
        best, best_score = None, 0.05
        reach = grazer.sight
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                x, y = self._wrap(grazer.x + dx, grazer.y + dy)
                score = self.grass[y][x] / (1.0 + math.hypot(dx, dy))
                if score > best_score:
                    best, best_score = (x, y), score
        return best

    def _step_toward(self, agent: Agent, target: tuple[int, int] | None, flee: bool = False) -> None:
        for _ in range(agent.steps):
            if target is None:
                dx, dy = self.rng.choice(((1, 0), (-1, 0), (0, 1), (0, -1), (0, 0)))
            else:
                tx, ty = target
                dx = (tx - agent.x + self.width // 2) % self.width - self.width // 2
                dy = (ty - agent.y + self.height // 2) % self.height - self.height // 2
                dx = (dx > 0) - (dx < 0)
                dy = (dy > 0) - (dy < 0)
                if flee:
                    dx, dy = -dx, -dy
                if dx and dy and self.rng.random() < 0.5:
                    dy = 0
            agent.x, agent.y = self._wrap(agent.x + dx, agent.y + dy)

    # -- main loop --------------------------------------------------------
    def step(self) -> None:
        self.tick += 1
        # Events are a mailbox the caller drains once it has published them, not a
        # per-tick scratch buffer. Clearing them here used to throw away everything
        # `apply_commands` had just recorded — a cull, a drought, a restart all ran
        # for real but left no mark, because the step that followed wiped the note
        # before anyone read it. The trim is only a ceiling for a caller that never
        # drains, such as a local run with no island service in front of it.
        if len(self.events) > 64:
            del self.events[:-64]
        p = self.params

        # 1. grass regrowth
        rate = float(p.get("grass_rate", 0.035))
        for row in self.grass:
            for i, value in enumerate(row):
                if value < 1.0:
                    row[i] = value + rate if value + rate < 1.0 else 1.0

        self._build_occupancy()
        self.rng.shuffle(self.agents)

        newborns: list[Agent] = []
        eaten: set[int] = set()

        prey_repro = float(p.get("prey_repro", 15.0))
        pred_repro = float(p.get("pred_repro", 75.0))
        lethality = float(p.get("lethality", 1.0))
        grass_energy = float(p.get("grass_energy", 4.2))
        pred_gain = float(p.get("pred_gain", 6.0))

        for agent in self.agents:
            if agent.uid in eaten:
                continue

            if agent.species == PREY:
                threat = self._nearest_predator(agent)
                if threat is not None and abs(threat.x - agent.x) <= 3 and abs(threat.y - agent.y) <= 3:
                    self._step_toward(agent, (threat.x, threat.y), flee=True)
                else:
                    self._step_toward(agent, self._best_grass(agent))
                bite = self.grass[agent.y][agent.x]
                if bite > 0.05:
                    agent.energy += bite * grass_energy * (0.65 + 0.35 * agent.genome["efficiency"])
                    self.grass[agent.y][agent.x] = 0.0
            else:
                quarry = self._nearest_prey(agent)
                self._step_toward(agent, (quarry.x, quarry.y) if quarry else None)
                for victim in list(self.occupancy.get((agent.x, agent.y), ())):
                    if victim.species != PREY or victim.uid in eaten:
                        continue
                    odds = _clamp(0.10 + 0.55 * agent.genome["guile"] - 0.60 * victim.genome["guile"]) * lethality
                    if self.rng.random() < odds:
                        agent.energy += pred_gain + 0.40 * victim.energy
                        eaten.add(victim.uid)
                        self.deaths_predated += 1
                        break

            agent.energy -= agent.upkeep()
            agent.age += 1

            threshold = prey_repro if agent.species == PREY else pred_repro
            if agent.energy > threshold:
                agent.energy *= 0.5
                child = Agent(
                    self._uid(),
                    agent.species,
                    *self._wrap(agent.x + self.rng.randint(-1, 1), agent.y + self.rng.randint(-1, 1)),
                    agent.energy,
                    self._mutate(agent.genome),
                    agent.origin,
                    self.tick,
                )
                newborns.append(child)
                self.births += 1

        max_age = int(p.get("max_age", 260))
        survivors = []
        for agent in self.agents:
            if agent.uid in eaten:
                continue
            if agent.energy <= 0:
                self.deaths_starved += 1
                continue
            if agent.age > max_age:
                self.deaths_old += 1
                continue
            survivors.append(agent)
        self.agents = survivors + newborns

        cap = int(p.get("carrying_capacity", 2200))
        if len(self.agents) > cap:
            self.rng.shuffle(self.agents)
            self.agents = self.agents[:cap]

    def _nearest_predator(self, prey: Agent) -> Agent | None:
        reach = prey.sight
        best, best_d = None, None
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                cell = self._wrap(prey.x + dx, prey.y + dy)
                for other in self.occupancy.get(cell, ()):
                    if other.species != PRED:
                        continue
                    d = math.hypot(dx, dy)
                    if best_d is None or d < best_d:
                        best, best_d = other, d
        return best

    # -- migration --------------------------------------------------------
    def take_emigrants(self, count: int) -> list[dict]:
        """Remove up to `count` individuals and return them serialized."""
        pool = [a for a in self.agents if a.energy > 6.0]
        if not pool:
            return []
        chosen = self.rng.sample(pool, min(count, len(pool)))
        picked = {a.uid for a in chosen}
        self.agents = [a for a in self.agents if a.uid not in picked]
        self.migrants_sent += len(chosen)
        return [a.to_dict() for a in chosen]

    def admit(self, payload: dict) -> None:
        """Admit a traveller, who lands on a random edge cell.

        A traveller marked `returning` is one this island sent out and a neighbour
        turned away at its shore. It is not an immigrant — it is a resident coming
        home — so it does not count as one, and it does not carry the blue ring that
        means "crossed the sea and stayed".
        """
        edge = self.rng.random()
        if edge < 0.5:
            x, y = self.rng.randrange(self.width), self.rng.choice((0, self.height - 1))
        else:
            x, y = self.rng.choice((0, self.width - 1)), self.rng.randrange(self.height)
        agent = Agent.from_dict(payload, self._uid(), x, y)
        if payload.get("returning"):
            agent.newcomer = False
            self.migrants_returned += 1
        else:
            self.migrants_received += 1
        self.agents.append(agent)

    # -- catastrophes and commands ----------------------------------------
    def cull(self, species: int, fraction: float) -> int:
        doomed = [a for a in self.agents if a.species == species and self.rng.random() < fraction]
        victims = {a.uid for a in doomed}
        self.agents = [a for a in self.agents if a.uid not in victims]
        self.events.append(f"cull:{species}:{len(victims)}")
        return len(victims)

    def seed_agents(self, species: int, count: int) -> None:
        for _ in range(count):
            self._spawn(species, energy=14.0 if species == PREY else 32.0)
        self.events.append(f"seed:{species}:{count}")

    def drain_events(self) -> list[str]:
        """Hand over everything that has happened since the last call, and forget it."""
        pending, self.events = self.events, []
        return pending

    # -- statistics -------------------------------------------------------
    def stats(self) -> dict:
        prey = [a for a in self.agents if a.species == PREY]
        pred = [a for a in self.agents if a.species == PRED]
        total_grass = sum(sum(row) for row in self.grass) / (self.width * self.height)
        row = {
            "island": self.name,
            "run": self.run,
            "tick": self.tick,
            "prey": len(prey),
            "predators": len(pred),
            "grass": round(total_grass, 4),
            "migrants_sent": self.migrants_sent,
            "migrants_received": self.migrants_received,
            "migrants_returned": self.migrants_returned,
            "births": self.births,
            "deaths_starved": self.deaths_starved,
            "deaths_predated": self.deaths_predated,
            "deaths_old": self.deaths_old,
            "foreign_prey": sum(1 for a in prey if a.origin != self.name),
            "foreign_predators": sum(1 for a in pred if a.origin != self.name),
            "immigrants_alive": sum(1 for a in self.agents if a.newcomer),
        }
        for label, group in (("prey", prey), ("pred", pred)):
            for trait in TRAITS:
                key = f"{label}_{trait}"
                row[key] = round(sum(a.genome[trait] for a in group) / len(group), 4) if group else 0.0
        return row

    # -- snapshot for the dashboard ---------------------------------------
    def snapshot(self) -> dict:
        grass_rows = ["".join(str(min(9, int(v * 9.99))) for v in row) for row in self.grass]
        # All four genes travel with each agent (not just speed) so the dashboard's
        # per-island detail view can show real trait distributions, not just a dot colour.
        agents = [
            [
                a.x, a.y, a.species,
                int(a.genome["speed"] * 9), int(a.genome["vision"] * 9),
                int(a.genome["efficiency"] * 9), int(a.genome["guile"] * 9),
                1 if a.newcomer else 0,
            ]
            for a in self.agents
        ]
        return {
            "island": self.name,
            "run": self.run,
            "tick": self.tick,
            "width": self.width,
            "height": self.height,
            "grass": grass_rows,
            "agents": agents,
            "stats": self.stats(),
            "events": list(self.events),
        }
