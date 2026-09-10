"""Unit tests for the simulation engine.

Run with: PYTHONPATH=src python3 -m unittest discover -s tests
No Redis and no Docker required — the engine is pure standard library.
"""

import unittest

from archipelago.engine import PRED, PREY, TRAITS, World


def run(ticks: int, **params) -> World:
    world = World("island-test", params, seed=params.pop("seed", 7))
    for _ in range(ticks):
        world.step()
    return world


class TestDeterminism(unittest.TestCase):
    def test_same_seed_same_history(self):
        a, b = run(120, seed=42), run(120, seed=42)
        self.assertEqual(a.stats(), b.stats())

    def test_different_seed_diverges(self):
        a, b = run(120, seed=1), run(120, seed=2)
        self.assertNotEqual(a.stats()["prey"], b.stats()["prey"])


class TestEcology(unittest.TestCase):
    def test_populations_survive_a_long_run(self):
        world = run(800, seed=11, grass_rate=0.05)
        stats = world.stats()
        self.assertGreater(stats["prey"], 0, "prey went extinct in the default environment")
        self.assertGreater(stats["predators"], 0, "predators went extinct in the default environment")

    def test_predators_starve_without_prey(self):
        world = World("island-test", {"initial_prey": 0, "initial_predators": 30}, seed=3)
        for _ in range(220):
            world.step()
        self.assertEqual(world.stats()["predators"], 0)

    def test_grass_regrows_when_grazers_are_absent(self):
        world = World("island-test", {"initial_prey": 0, "initial_predators": 0, "grass_rate": 0.1}, seed=5)
        before = world.stats()["grass"]
        for _ in range(40):
            world.step()
        self.assertGreater(world.stats()["grass"], before)

    def test_selection_moves_traits(self):
        """With lethal predators, surviving prey should be more evasive than the founders."""
        world = World("island-test", {"lethality": 2.0, "mutation": 0.08}, seed=17)
        start = world.stats()["prey_guile"]
        for _ in range(600):
            world.step()
        self.assertGreater(world.stats()["prey_guile"], start)


class TestMigration(unittest.TestCase):
    def test_emigrants_leave_and_serialize(self):
        world = run(60, seed=9)
        before = len(world.agents)
        travellers = world.take_emigrants(5)
        self.assertEqual(len(travellers), 5)
        self.assertEqual(len(world.agents), before - 5)
        for payload in travellers:
            self.assertIn("genome", payload)
            self.assertEqual(set(payload["genome"]), set(TRAITS))

    def test_admit_marks_newcomers_but_not_their_children(self):
        source, target = run(60, seed=9), run(60, seed=21)
        for payload in source.take_emigrants(4):
            target.admit(payload)
        self.assertEqual(target.stats()["immigrants_alive"], 4)
        self.assertEqual(target.migrants_received, 4)
        for _ in range(120):
            target.step()
        stats = target.stats()
        lineage = stats["foreign_prey"] + stats["foreign_predators"]
        self.assertGreaterEqual(lineage, stats["immigrants_alive"])

    def test_round_trip_preserves_the_genome(self):
        world = run(30, seed=4)
        payload = world.take_emigrants(1)[0]
        other = run(30, seed=6)
        other.admit(payload)
        landed = [a for a in other.agents if a.newcomer][0]
        for trait in TRAITS:
            self.assertAlmostEqual(landed.genome[trait], payload["genome"][trait], places=4)


class TestCommands(unittest.TestCase):
    def test_seed_and_cull(self):
        world = run(40, seed=8)
        before = sum(1 for a in world.agents if a.species == PRED)
        world.seed_agents(PRED, 25)
        self.assertEqual(sum(1 for a in world.agents if a.species == PRED), before + 25)
        prey_before = sum(1 for a in world.agents if a.species == PREY)
        world.cull(PREY, 1.0)
        self.assertEqual(sum(1 for a in world.agents if a.species == PREY), 0)
        self.assertGreater(prey_before, 0)


class TestSnapshot(unittest.TestCase):
    def test_shape_is_what_the_dashboard_expects(self):
        world = run(20, seed=2)
        snap = world.snapshot()
        self.assertEqual(len(snap["grass"]), snap["height"])
        self.assertEqual(len(snap["grass"][0]), snap["width"])
        self.assertEqual(len(snap["agents"]), len(world.agents))
        for x, y, species, speed, vision, efficiency, guile, newcomer in snap["agents"]:
            self.assertTrue(0 <= x < snap["width"] and 0 <= y < snap["height"])
            self.assertIn(species, (PREY, PRED))
            self.assertIn(newcomer, (0, 1))
            for gene in (speed, vision, efficiency, guile):
                self.assertTrue(0 <= gene <= 9)

    def test_stats_expose_every_trait(self):
        stats = run(20, seed=2).stats()
        for trait in TRAITS:
            self.assertIn(f"prey_{trait}", stats)
            self.assertIn(f"pred_{trait}", stats)


if __name__ == "__main__":
    unittest.main()


class TestCommandsAndRuns(unittest.TestCase):
    """Behaviour that broke once and would break silently again."""

    def test_events_survive_the_next_step(self):
        """A command's mark must reach the snapshot the island publishes.

        `step` used to clear `events` at the top, which discarded everything
        `apply_commands` had just recorded: the cull happened, the drought happened,
        but the run strip never showed a tick for either.
        """
        world = World("evented", {"initial_prey": 60, "initial_predators": 6}, seed=3)
        world.cull(PREY, 0.5)
        world.step()
        self.assertTrue(any(e.startswith("cull:") for e in world.snapshot()["events"]))

        # ...and exactly once: draining is what marks them published.
        self.assertTrue(world.drain_events())
        world.step()
        self.assertEqual(world.snapshot()["events"], [])

    def test_reset_starts_a_new_run_and_keeps_parameters(self):
        world = World(
            "restarted",
            {"initial_prey": 40, "initial_predators": 4, "grass_rate": 0.09},
            seed=7,
        )
        for _ in range(25):
            world.step()
        self.assertEqual((world.tick, world.run), (25, 1))

        world.reset()
        self.assertEqual(world.run, 2)
        self.assertEqual(world.tick, 0)
        self.assertEqual(world.births, 0)
        self.assertEqual(world.migrants_sent, 0)
        self.assertEqual(len(world.agents), 44)
        # A restart is not an undo: whatever the dashboard had set is still set.
        self.assertEqual(world.params["grass_rate"], 0.09)
        self.assertTrue(any(e.startswith("reset:") for e in world.events))
        self.assertEqual(world.stats()["run"], 2)

    def test_returned_traveller_is_not_counted_as_an_immigrant(self):
        """One this island sent out and a neighbour turned away is a resident coming home."""
        world = World("home", {"initial_prey": 30, "initial_predators": 3}, seed=11)
        outbound = world.take_emigrants(2)
        self.assertEqual(len(outbound), 2)

        world.admit(dict(outbound[0], **{"from": "home", "returning": 1}))
        world.admit(dict(outbound[1], **{"from": "elsewhere"}))

        self.assertEqual(world.migrants_returned, 1)
        self.assertEqual(world.migrants_received, 1)
        # Only the genuine arrival wears the blue ring.
        self.assertEqual(sum(1 for a in world.agents if a.newcomer), 1)
