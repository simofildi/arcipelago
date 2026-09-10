/* Entry point: wiring, the polling loop and the layout.

   The module graph is a tree, not a web. state.js, params.js and palette.js import
   nothing; tooltip.js, sea.js, run.js and panel.js import only from those; this file
   imports everything and is the only place the pieces are connected to each other.
   Where two modules would otherwise have needed each other — the sea has to open the
   panel, the panel has to re-lay the sea — the dependency is injected from here. */

import { cards, series, latest, lastSent, marks, app, calm, figure } from "./state.js";
import { readPalette } from "./palette.js";
import { initTooltips } from "./tooltip.js";
import { rebuild, paintIsland, launch, animate, setSelectHandler } from "./sea.js";
import { drawRun, noteMark } from "./run.js";
import { buildStart, showStart } from "./start.js";
import { describeEvent, WINDOWS } from "./params.js";
import { select, buildPanel, paintPanel, showDeck, paintDeck, openArchipelago,
         paintArchipelago, paintClock, paintPresetState, setLayoutHandler } from "./panel.js";

const sea = document.getElementById("sea");
const panel = document.getElementById("panel");
const deck = document.getElementById("deck");
const timeline = document.getElementById("timeline");

function record(snap) {
  let line = series.get(snap.island) || [];
  // A restart sends the clock back to zero. The strip is a picture of one run, so
  // the previous one is dropped here rather than folded back over the new ticks;
  // results.csv keeps it, tagged with its run number.
  if (line.length && snap.tick < line[line.length - 1][0]) {
    line = [];
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i].island === snap.island) marks.splice(i, 1);
    }
  }
  line.push([snap.tick, snap.stats.prey, snap.stats.predators]);
  // Halve the resolution rather than dropping the beginning: the strip is labelled
  // "the run so far", and a sliding window would quietly stop being true.
  if (line.length > 900) {
    series.set(snap.island, line.filter((_, i) => i % 2 === 0));
  } else {
    series.set(snap.island, line);
  }
}

async function refresh() {
  let data;
  try {
    const res = await fetch("/state");
    data = await res.json();
  } catch (err) {
    paintClock(0, false, true);
    return;
  }

  // The snapshot's own control block is the authority: the Redis hash only holds
  // keys the dashboard has explicitly written, so a fresh island would show nothing.
  for (const snap of data.islands) {
    app.controls[snap.island] = Object.assign({}, data.controls[snap.island], snap.controls);
    if (snap.defaults) app.defaults[snap.island] = snap.defaults;
  }

  const arriving = data.islands.map(s => s.island);
  if (arriving.length && (arriving.length !== cards.size || arriving.some(n => !cards.has(n)))) {
    app.names = arriving;
    rebuild(data.islands);
    if (app.selected && !cards.has(app.selected)) app.selected = null;
    if (app.selected) select(app.selected);
    else if (app.view === "arch") openArchipelago();
    else showDeck();
  }

  let tick = 0;
  for (const snap of data.islands) {
    latest.set(snap.island, snap);
    record(snap);
    paintIsland(snap);
    tick = Math.max(tick, snap.tick);
    // The island reports what actually happened to it, so these are the authority
    // for the run strip: a cull is recorded with the number it really killed. Each
    // event carries the tick it happened on and is repeated for a few seconds, since
    // the snapshot is a last-value key the island overwrites faster than this poll
    // reads it — so the tick is what places the mark, and what identifies a repeat.
    for (const event of snap.events || []) {
      const at = typeof event === "object" ? event.tick : snap.tick;
      const info = describeEvent(typeof event === "object" ? event.text : event);
      if (!marks.some(m => m.island === snap.island && m.tick === at && m.title === info.title)) {
        noteMark(snap.island, at, info, snap.stats);
      }
    }
  }
  if (app.selected && latest.has(app.selected)) paintPanel(latest.get(app.selected));
  paintDeck();
  paintArchipelago();
  paintPresetState();

  // The gate belongs to the run, not to this browser: it is answered from the state
  // every poll, so a reload mid-run does not offer to start what is already running.
  const armed = data.started === false;
  showStart(armed);
  // "The run so far" has nothing to say before there is a run, and an empty chart is
  // worse than no chart. It appears with the first generation.
  if (timeline.hidden !== armed) {
    timeline.hidden = armed;
    relayout();
  }

  paintClock(tick, data.finished, false);

  for (const snap of data.islands) {
    const before = lastSent.get(snap.island);
    if (before !== undefined && snap.stats.migrants_sent > before && !calm.matches) {
      launch(snap.island, snap.stats.migrants_sent - before);
    }
    lastSent.set(snap.island, snap.stats.migrants_sent);
  }

  drawRun();
}

/* ---- layout ---- */

// The run strip stops short of the right-hand column rather than sliding under it,
// and the archipelago is laid out in whatever water is left. One measurement feeds
// both, so they can never disagree.
function syncInsets() {
  const column = panel.hidden ? deck : panel;
  const inset = (app.stacked || column.hidden) ? 0 : column.getBoundingClientRect().width + 18;
  document.documentElement.style.setProperty("--panel-inset", inset + "px");
  document.documentElement.style.setProperty("--strip-h", timeline.getBoundingClientRect().height + "px");
}

let resizeTimer = null;

function relayout() {
  app.geometry = null;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    app.stacked = window.matchMedia("(max-width: 940px)").matches;
    syncInsets();
    const snapshots = app.names.map(n => latest.get(n)).filter(Boolean);
    if (snapshots.length) {
      rebuild(snapshots);
      snapshots.forEach(paintIsland);
      for (const [other, card] of cards) card.el.setAttribute("aria-pressed", String(other === app.selected));
    }
    drawRun();
  }, 160);
}

window.addEventListener("resize", relayout);

// How much of the run the strip shows. Kept in the browser rather than in Redis:
// it is a way of looking at the archipelago, not a fact about it, so two people can
// reasonably want different windows on the same run.
const windowBar = document.getElementById("run-window");
for (const option of WINDOWS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "radio");
  btn.dataset.window = option.id;
  btn.setAttribute("aria-checked", String(app.window === option.id));
  btn.setAttribute("data-tip-title", option.id === "all" ? "The whole run" : `Last ${option.label} generations`);
  btn.setAttribute("data-tip", option.help);
  btn.textContent = option.label;
  btn.addEventListener("click", () => {
    app.window = option.id;
    for (const other of windowBar.children) other.setAttribute("aria-checked", "false");
    btn.setAttribute("aria-checked", "true");
    drawRun();
  });
  windowBar.appendChild(btn);
}

document.getElementById("strip-toggle").addEventListener("click", () => {
  const shut = timeline.classList.toggle("is-shut");
  const btn = document.getElementById("strip-toggle");
  btn.setAttribute("aria-expanded", String(!shut));
  btn.setAttribute("aria-label", shut ? "Expand the run strip" : "Collapse the run strip");
  relayout();
});

// Clicking the open water is the other way back: the islands stop the event, so a
// click that reaches the sea itself is a click on nothing in particular.
sea.addEventListener("click", e => {
  if (!e.target.closest(".isle") && app.view !== "deck") showDeck();
});

sea.addEventListener("keydown", e => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const step = e.key === "ArrowRight" ? 1 : -1;
  const i = app.names.indexOf(app.selected);
  if (i < 0) return;
  const next = app.names[(i + step + app.names.length) % app.names.length];
  select(next);
  cards.get(next).el.focus();
  e.preventDefault();
});

/* ---- start ----------------------------------------------------------------
   The module graph is a tree, and these two lines are where the two edges that
   would have closed it into a cycle are injected instead: the sea has to be able to
   open the panel, and the panel has to be able to re-lay the sea. */

readPalette();
initTooltips();
buildStart();
setSelectHandler(select);
setLayoutHandler(first => { syncInsets(); if (first) relayout(); });

// The palette tokens change under a light/dark switch and a canvas cannot notice on
// its own, so the rasters and the run strip are repainted by hand when they do.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  readPalette();
  for (const snap of latest.values()) paintIsland(snap);
  drawRun();
});

syncInsets();
refresh();
setInterval(refresh, 300);
requestAnimationFrame(animate);
