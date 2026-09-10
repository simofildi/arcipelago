/* Shared mutable state and the two helpers every module needs.

   Imports nothing, so it can never take part in a cycle: every other module hangs
   off this one. The stores are plain Maps rather than a reactive layer because the
   whole page is redrawn from a snapshot four times a second anyway — there is no
   diffing worth doing, and a Map is the honest description of what this holds. */

export const DPR = Math.min(2, window.devicePixelRatio || 1);

export const cards = new Map();    // island -> its raster and the buffers behind it
export const series = new Map();   // island -> [tick, prey, predators] for the whole run
export const lastSent = new Map(); // island -> migrants_sent at the previous poll
export const latest = new Map();   // island -> its most recent snapshot
export const marks = [];           // interventions, drawn as ticks on the run strip
export const rafts = [];           // individuals crossing the water right now

/* Single-valued state lives on one object rather than as exported `let` bindings,
   because an imported binding is read-only at the far end and every module would
   otherwise need a setter of its own. */
export const app = {
  // "deck" is the resting state, "arch" the scenarios, or the name of one island.
  view: "deck",
  names: [],
  controls: {},
  defaults: {},
  selected: null,
  cell: 0,
  window: "600",   // which slice of the run the strip shows

  geometry: null,
  stacked: window.matchMedia("(max-width: 940px)").matches
};

export const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

export function post(path, body) {
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => {});
}

export function figure(n) { return Number(n).toLocaleString("en-US"); }
