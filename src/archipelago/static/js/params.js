/* Parameters, scenarios and copy. Pure data with no imports and no DOM: this is the
   file to open to change what the dashboard exposes or how it explains itself.

   Every key here is one the island reads back out of Redis at the top of each
   generation, so adding a slider means adding an entry to PARAMS, naming it in a
   GROUPS entry, and adding the key to island.py's LIVE_KEYS — nothing else.

   Defaults are the values the containers actually boot with and are not invented:
   they were tuned by sweeping for predator-prey coexistence over 1500+ generations
   across several seeds. The ranges and the wording of `help` are anchored to the
   canonical teaching model of this system, NetLogo's Wolf Sheep Predation (Wilensky
   1997), whose slider bounds are quoted in `ref` wherever there is a direct
   analogue. Every entry must carry a `help`: a control nobody can interpret is not
   a control. */

export const GROUPS = [
  {
    name: "Grass and grazing",
    note: "what prey live on",
    help: "Grass grows back in every cell of the island, and prey eat it. These two sliders set how fast the island feeds itself and how much a mouthful is worth.",
    keys: ["grass_rate", "grass_energy"]
  },
  {
    name: "Hunting",
    note: "what predators live on",
    help: "Predators do not graze; they catch prey. These two set how often a chase succeeds and what a kill is worth.",
    keys: ["lethality", "pred_gain"]
  },
  {
    name: "Birth and death",
    note: "the life cycle",
    help: "An individual splits in two once it has stored enough energy, and dies when it runs out, gets eaten, or grows too old. These four set those thresholds.",
    keys: ["prey_repro", "pred_repro", "max_age", "carrying_capacity"]
  },
  {
    name: "Evolution",
    note: "how genes drift",
    help: "Every individual carries four genes. Offspring inherit their parent's genes with a small random nudge, and whichever version survives longer becomes more common. This slider sets the size of that nudge.",
    keys: ["mutation"]
  },
  {
    name: "Migration",
    note: "the other containers",
    help: "The only reason this project needs more than one container. The archipelago is a full mesh, not a ring: every island reaches every other island directly, and each wave is split evenly between them, so a gene that appears here can turn up anywhere one crossing later.",
    keys: ["migrants_per_wave", "migration_interval"]
  }
];

export const PARAMS = {
  grass_rate: {
    label: "Grass regrowth", min: 0.005, max: 0.15, step: 0.005, dec: 3, unit: " / gen",
    help: "How much grass grows back in each cell every generation, as a fraction of a full cell. At 0.05 a cell that has just been eaten is full again twenty generations later. Raise it and prey find food wherever they wander; lower it and grazing becomes a race that only the efficient survive.",
    ref: "NetLogo grass-regrowth-time 20 ticks, expressed here as a rate"
  },
  grass_energy: {
    label: "Energy per mouthful", min: 1, max: 10, step: 0.1, dec: 1, unit: "",
    help: "Energy a prey gains from clearing one full cell of grass. Efficient individuals extract more of it than wasteful ones. Below roughly 2 a prey cannot cover its own upkeep and the whole island starves, however much grass there is.",
    ref: "NetLogo sheep-gain-from-food: default 4, slider 1 to 10"
  },
  lethality: {
    label: "Hunting success", min: 0, max: 2, step: 0.05, dec: 2, unit: "x",
    help: "Multiplies a predator's chance of killing a prey it lands on. At 1 the odds are settled entirely by the two genomes involved: the hunter's guile against the victim's camouflage. At 0 predators can never eat. Much above 1.4 they usually strip the island bare and then die with it.",
    ref: "no NetLogo equivalent: there a wolf that lands on a sheep always eats it"
  },
  pred_gain: {
    label: "Energy per kill", min: 1, max: 50, step: 0.5, dec: 1, unit: "",
    help: "Energy a predator gains for each kill, on top of forty per cent of whatever the victim was carrying. Raise it and a single successful hunt funds a whole litter, which is the fastest way to see a predator boom followed by a crash.",
    ref: "NetLogo wolf-gain-from-food: default 20, slider 1 to 50"
  },
  prey_repro: {
    label: "Prey birth energy", min: 5, max: 40, step: 1, dec: 0, unit: "",
    help: "Energy a prey must have stored before it splits in two, each half keeping half the energy. Lower it for a population boom that will eventually feed the predators; raise it and prey become scarce and predators follow them down.",
    ref: "NetLogo uses a per-tick probability instead; a threshold makes the energy budget explicit"
  },
  pred_repro: {
    label: "Predator birth energy", min: 20, max: 160, step: 5, dec: 0, unit: "",
    help: "The same threshold for predators. It is deliberately about five times the prey figure, because several prey have to be converted into one new hunter. Dropping it below roughly 60 floods the island with predators and both species crash together within a few hundred generations.",
    ref: "tuned here: at 90 instead of 75, two seeds in five collapse"
  },
  max_age: {
    label: "Lifespan", min: 60, max: 600, step: 10, dec: 0, unit: " gen",
    help: "Generations an individual lives before dying of old age, however much energy it has. It puts a ceiling on how long a single very well adapted lineage can hold its ground, which keeps turnover — and therefore evolution — going.",
    ref: "no NetLogo equivalent: there animals die only of starvation or predation"
  },
  carrying_capacity: {
    label: "Carrying capacity", min: 400, max: 5000, step: 100, dec: 0, unit: "",
    help: "Hard ceiling on how many individuals this island can hold at once. When it is passed the surplus is removed at random, standing in for every limit the grid does not model: disease, fresh water, room to nest. It also keeps one container from eating the whole machine.",
    ref: "the grid is 64 by 40, so 2200 is roughly one individual per cell"
  },
  mutation: {
    label: "Mutation", min: 0, max: 0.2, step: 0.005, dec: 3, unit: " sd",
    help: "Spread of the random nudge every gene receives at birth, as a standard deviation on a nought-to-one scale. At 0 the population can only reshuffle the genes it already has. Around 0.10 novelty appears fast, but nothing stays fixed long enough to pay off, so the island never really adapts.",
    ref: "island-3 runs at 0.10 on purpose: it is where new genes come from"
  },
  migrants_per_wave: {
    label: "Individuals per wave", min: 0, max: 20, step: 1, dec: 0, unit: "",
    help: "How many individuals leave on each wave, dealt out evenly to every other island in turn — with two neighbours and a wave of six, three go each way. With roughly 300 residents, six is about two per cent — comfortably under the ten per cent that population biology treats as the line between islands that drift apart genetically and islands that behave as a single population.",
    ref: "field studies report mean migration of 5 to 10 per cent per generation"
  },
  migration_interval: {
    label: "Generations between waves", min: 5, max: 200, step: 5, dec: 0, unit: " gen",
    help: "How long the island waits before sending the next wave. Short intervals mean a constant trickle of foreign genes and three islands that stay similar. Long intervals let each island evolve on its own, punctuated by rare arrivals that can rescue a collapsing population outright.",
    ref: "compose ships 25, which at 12 generations a second is a wave every two seconds"
  }
};

/* Four archipelago-wide scenarios. Each one is a partial override laid on top of
   whatever each island booted with, never a flat set of identical values: the three
   environments are supposed to stay different from each other, and a preset that
   erased that difference would also erase the reason there are three containers.
   "Balanced" is the empty override, so it simply restores every island's own start. */
export const PRESETS = [
  {
    id: "balanced", name: "Balanced", note: "the tuned ridge",
    help: "Every island back to the values its container booted with. Predators and prey coexist and oscillate against each other for thousands of generations. These numbers were found by sweeping for coexistence across several seeds, and they sit on a narrow ridge: the other three presets are all built by stepping off it deliberately.",
    set: {}
  },
  {
    id: "boom", name: "Boom and bust", note: "violent cycles",
    help: "Rich grass and cheap predators. Prey explode, predators follow them up a few dozen generations later, eat the prey down to almost nothing, and starve in turn — the textbook Lotka-Volterra cycle, with an amplitude large enough to see without squinting. Islands do go locally extinct under this one; watch a neighbour repopulate them.",
    set: { grass_rate: 0.11, grass_energy: 6.0, pred_repro: 45, lethality: 1.2, isolated: 0 }
  },
  {
    id: "armsrace", name: "Arms race", note: "guile escalates",
    help: "Hard hunting, generous kills and fast mutation. Prey are pushed hard toward camouflage and predators toward hunting skill, so open the mean genes panel and watch both guile bars climb together. Energy is what stops it running away: guile costs upkeep, and a perfectly hidden prey is too expensive to feed itself.",
    set: { lethality: 1.4, pred_gain: 12, mutation: 0.12, max_age: 400, isolated: 0 }
  },
  {
    id: "marooned", name: "Marooned", note: "no migration",
    help: "Every strait closed in both directions. The islands keep running but stop trading entirely, which is the control case for this whole project: gene pools drift apart, the crossing counters stop, and an island that crashes has nobody to rescue it. Switch back to Balanced and watch the neighbours refill it.",
    set: { isolated: 3 }
  }
];

/* The strait is a two-bit gate, not a switch: `isolated` is 1 for no departures, 2
   for no arrivals, 3 for both. Leaving and arriving are separate questions — an
   island that exports its genes but accepts none of yours behaves nothing like one
   that only takes — and the two bits let you ask either on its own. The values here
   must stay in step with NO_DEPARTURES and NO_ARRIVALS in island.py. */
export const STRAIT = [
  { value: 0, name: "Open", note: "both ways",
    help: "Individuals leave on every wave and land here from the other islands. This is how the archipelago normally runs, and the only setting under which genes actually circulate." },
  { value: 1, name: "No departures", note: "arrivals only",
    help: "Nobody leaves this island, but travellers from the others still land here. The island becomes a sink: it collects foreign genes and gives none back, so watch its mean genes drift toward its neighbours' while theirs stop hearing from it." },
  { value: 2, name: "No arrivals", note: "departures only",
    help: "Waves still leave, but nobody is admitted. Travellers who reach this shore are turned back and sail home, where they rejoin the island they set out from — they are not killed, and they are counted as residents returning rather than as immigrants. The island becomes a source: it seeds the others while evolving entirely on its own, which is the cleanest way to see local adaptation with no rescue effect." },
  { value: 3, name: "Closed", note: "cut off",
    help: "Both directions shut. Nothing leaves, and anything that reaches this shore is turned back to the island it came from. The clearest single demonstration that the containers are really coordinating: close it and the water beside it empties, its crossing counters freeze, and nothing rescues it if it crashes." }
];

/** The badge under an island, or nothing when its strait is open. */
export function straitLabel(value) {
  const mode = STRAIT.find(m => m.value === (Number(value) | 0));
  return !mode || mode.value === 0 ? "" : mode.name;
}

/* How much of the run the strip shows. A rolling window keeps the recent shape
   legible while a run heads into five figures; "All" starts at generation one and
   fits the whole thing, which is what you want after a restart or when comparing the
   beginning of a run with where it ended up. */
/* How long a run lasts, offered before it starts. Presets rather than a free number
   because the question is "long enough to see what?", not "how many", and the answers
   are the three shapes worth watching: one cycle, a few, and a long settling. */
export const RUN_LENGTHS = [
  { id: "400", label: "400", generations: 400,
    help: "About 35 seconds. Long enough for the first predator-prey cycle to turn and for the first migrants to land, and short enough to run several times over while you change the parameters." },
  { id: "600", label: "600", generations: 600, preselected: true,
    help: "About a minute. Two or three cycles, enough for the islands to start drifting apart from each other and for selection to move the traits visibly." },
  { id: "1000", label: "1,000", generations: 1000,
    help: "Under two minutes. Long enough that a population can crash and be rescued by immigration from a neighbour, which is the phenomenon the archipelago exists to show." },
  { id: "open", label: "No limit", generations: 0,
    help: "Runs until you stop it, with no ceiling at all. The output files are written as it goes, so you can leave it evolving for as long as you like and stop it with Ctrl-C in the terminal." }
];

export const WINDOWS = [
  { id: "300", label: "300", span: 300, help: "The last 300 generations. Close enough to watch a single predator-prey cycle turn." },
  { id: "600", label: "600", span: 600, help: "The last 600 generations \u2014 a few cycles, still detailed." },
  { id: "1000", label: "1k", span: 1000, help: "The last 1,000 generations." },
  { id: "all", label: "All", span: 0, help: "Everything this page has recorded, fitted to the width of the strip. That is the whole run from generation one if you were here when it started or since you last restarted it, and otherwise from the moment you opened the page \u2014 the islands publish their current state, not their history, so the browser cannot show you what it did not see. Detail is lost as the run grows, but the long trend and every intervention stay on screen." }
];

export const SWITCHES = [
  { key: "paused", label: "Pause this island",
    help: "Freeze this island's clock without losing its population or its history. Its neighbours keep running, so you can watch what happens to them when one ecosystem stops trading." }
];

export const ACTS = [
  { op: "seed", label: "Add 80 prey", body: { species: "prey", count: 80 },
    help: "Release 80 prey with fresh random genomes, as though a boat had tipped over. Watch the predator line follow the spike a few dozen generations later." },
  { op: "seed", label: "Add 20 predators", body: { species: "predators", count: 20 },
    help: "Release 20 predators with fresh random genomes. The usual outcome is a short glut, a prey crash, then a predator crash." },
  { op: "drought", label: "Drought", body: {},
    help: "Burn the grass down to fifteen per cent of what it was, in a single generation. Efficient prey survive it and wasteful ones do not, so it is the fastest way to see selection act." },
  { op: "cull", label: "Epidemic", body: { species: "prey", fraction: 0.45 },
    help: "Kill roughly forty-five per cent of the prey at random, with no regard for how well adapted they are. Unlike the drought this selects for nothing, so it shows what a purely demographic shock does." }
];

export const TRAITS = [
  { key: "speed", label: "Speed", help: "How many cells the individual moves each generation. Faster individuals reach food and escape hunters sooner, but movement is the largest single item in an energy budget and the cost rises with the square of speed." },
  { key: "vision", label: "Vision", help: "The radius, in cells, at which the individual notices food or a threat. Wide vision finds the best grass patch and spots a predator early, and costs a little energy every generation whether or not it sees anything." },
  { key: "efficiency", label: "Efficiency", help: "A metabolic multiplier: it cuts every other cost the individual pays, and lets prey extract more energy from the same mouthful of grass. It is the trait that wins droughts." },
  { key: "guile", label: "Guile", help: "One gene read two ways. In a predator it is hunting skill and raises the odds of a kill; in a prey it is camouflage and shrinks the radius at which a predator can see it. Both sides pay energy to carry it, which is what stops prey evolving perfect camouflage and wiping the predators out." }
];

/* Environments an island can be set to.

   These replace the three hard-coded captions that used to sit under the rasters.
   Those captions were a lie the moment anybody touched a slider: they were keyed to
   the island's name, so "Lush grassland" stayed on screen while you dragged grass
   regrowth to nothing. An environment is a set of parameters and nothing else, and
   the caption is derived from the parameters actually in force — see `describe`
   below — so it follows a preset, a slider, or a scenario without being told. */
export const ENVIRONMENTS = [
  {
    id: "grassland", name: "Lush grassland", note: "easy living",
    help: "Deep grass and unhurried predators. Prey are rarely short of food, so selection acts mostly on what to do with the surplus rather than on how to survive. Populations run large and the cycles are shallow.",
    set: { grass_rate: 0.085, grass_energy: 5.0, lethality: 0.8, pred_gain: 6, mutation: 0.04 }
  },
  {
    id: "thin", name: "Thin soil", note: "hard living",
    help: "Little grass and ruthless hunting. Every mouthful matters, so efficiency and camouflage are what survive here. Populations are smaller and far more sensitive to a bad generation.",
    set: { grass_rate: 0.03, grass_energy: 3.6, lethality: 1.3, pred_gain: 6, mutation: 0.04 }
  },
  {
    id: "restless", name: "Restless climate", note: "fast drift",
    help: "An ordinary environment with genes that will not sit still. New variants appear here faster than anywhere else and travel out to the other islands, which makes this one the archipelago's source of novelty.",
    set: { grass_rate: 0.05, grass_energy: 4.2, lethality: 1.0, pred_gain: 6, mutation: 0.11 }
  },
  {
    id: "stronghold", name: "Predator stronghold", note: "hunters favoured",
    help: "Hunting is easy and a kill is worth a great deal, so predators build up fast. Prey survive here only by becoming genuinely hard to catch, and the island often overshoots and crashes before they manage it.",
    set: { grass_rate: 0.06, grass_energy: 4.2, lethality: 1.5, pred_gain: 11, pred_repro: 60, mutation: 0.05 }
  },
  {
    id: "refuge", name: "Prey refuge", note: "hunters starved",
    help: "Predators rarely land a kill and need a great deal of energy to breed, so prey dominate until they eat the island bare and starve themselves. A good place to watch a population find its own ceiling with nothing hunting it.",
    set: { grass_rate: 0.07, grass_energy: 4.6, lethality: 0.45, pred_gain: 6, pred_repro: 95, mutation: 0.04 }
  },
  {
    id: "crowded", name: "Crowded island", note: "small and full",
    help: "A hard ceiling well below what the grass could support, so the island is permanently at capacity and the surplus is culled at random every generation. Selection gets noisier, because dying here has less to do with being unfit.",
    set: { grass_rate: 0.09, grass_energy: 4.6, lethality: 1.0, carrying_capacity: 800, mutation: 0.05 }
  }
];

/* The caption under an island, derived from the parameters in force rather than
   stored anywhere. Three clauses, one per axis a person can actually feel: how much
   there is to eat, how dangerous it is, and how fast the genes move. Because it is
   computed, it can never disagree with the sliders above it. */
export function describe(controls) {
  if (!controls) return "island ecosystem";
  const grass = Number(controls.grass_rate);
  const lethal = Number(controls.lethality);
  const drift = Number(controls.mutation);
  if (!isFinite(grass) || !isFinite(lethal) || !isFinite(drift)) return "island ecosystem";

  const food = grass < 0.032 ? "Barren ground"
             : grass < 0.058 ? "Sparse grass"
             : grass < 0.088 ? "Steady grass"
             : "Deep grass";
  const risk = lethal < 0.55 ? "predators that rarely kill"
             : lethal < 0.95 ? "gentle hunting"
             : lethal < 1.25 ? "even hunting"
             : lethal < 1.55 ? "hard hunting"
             : "ruthless hunting";
  const genes = drift < 0.025 ? "genes that barely move"
              : drift < 0.075 ? "steady drift"
              : "fast drift";
  return `${food}, ${risk}, ${genes}`;
}

/* Interventions, as they appear on the run strip.

   The island publishes an event for anything that actually happened to it —
   "cull:0:412", "seed:1:20", "drought", "reset:2" — and those strings are the source
   of truth here, not what the button asked for: a cull is reported with the number
   of individuals it really killed, which is never quite the number you aimed at.
   Changes that leave no trace in the ecosystem (a strait, a pause, an environment)
   have no engine event, so the panel records those itself. */
const SPECIES = ["prey", "predators"];

export function describeEvent(raw) {
  const [kind, a, b] = String(raw).split(":");
  if (kind === "cull") {
    const n = Number(b) || 0;
    return {
      kind, title: "Epidemic",
      quick: `${n.toLocaleString("en-US")} ${SPECIES[Number(a)] || "individuals"} killed`,
      detail: `A random ${SPECIES[Number(a)] || "population"} die-off: ${n.toLocaleString("en-US")} individuals were removed at random, with no regard for how well adapted they were. Because it selects for nothing, what follows is a purely demographic recovery — useful as a control against the drought, which does select.`
    };
  }
  if (kind === "seed") {
    const n = Number(b) || 0;
    return {
      kind, title: "Individuals released",
      quick: `${n.toLocaleString("en-US")} ${SPECIES[Number(a)] || "individuals"} introduced`,
      detail: `${n.toLocaleString("en-US")} ${SPECIES[Number(a)] || "individuals"} were released with fresh random genomes, as though a boat had tipped over. They carry none of the adaptations this island has spent its run accumulating, so watch how quickly selection removes them again.`
    };
  }
  if (kind === "drought") {
    return {
      kind, title: "Drought",
      quick: "grass cut to 15 per cent",
      detail: "Every cell of grass was cut to fifteen per cent of what it held, in a single generation. Unlike the epidemic this selects hard: efficient prey survive it and wasteful ones do not, so the mean efficiency gene usually steps up within a few dozen generations of this mark."
    };
  }
  if (kind === "reset") {
    return {
      kind, title: "Run restarted",
      quick: `run ${a || "?"} began here`,
      detail: `The island was sent back to generation zero with fresh populations and a new draw of random genomes. Sliders were kept. Everything to the left of this mark belongs to the previous run and is still in results.csv under its own run number.`
    };
  }
  return { kind: kind || "event", title: kind || "Event", quick: String(raw), detail: String(raw) };
}
