/* The panel: scenarios, the collapsible parameter groups, switches, interventions
   and the readouts. Everything the person can touch, and every explanation of it. */

import { cards, latest, app, post, figure } from "./state.js";
import { GROUPS, PARAMS, PRESETS, SWITCHES, ACTS, TRAITS, ENVIRONMENTS,
         STRAIT, straitLabel, describe } from "./params.js";
import { infoTag } from "./tooltip.js";
import { noteMark } from "./run.js";

const panel = document.getElementById("panel");
const panelBody = document.getElementById("panel-body");
const panelTop = document.getElementById("panel-top");
const deck = document.getElementById("deck");

// Injected by app.js: opening the panel for the first time narrows the water, so
// the archipelago has to be laid out again. Importing app.js from here would make
// the two modules circular, and a callback says the dependency direction out loud.
let onLayoutChange = () => {};
export function setLayoutHandler(fn) { onLayoutChange = fn; }

// Any hand-moved slider or switch means the archipelago no longer matches a preset,
// so the highlight comes off rather than claiming something untrue.
/* Which preset an island is on is stored in Redis beside its parameters, under keys
   the simulation itself ignores. That is deliberate: the choice has to outlive a
   page reload and be the same for two people looking at the same archipelago, and
   the control hash is already the one place where "what this island is set to"
   lives. island.py only reads the keys in LIVE_KEYS, so these ride along harmlessly. */
/* Anything done from the panel that changes what an island is running should leave a
   tick on the run strip, or the curve that follows it has no explanation. The
   engine reports what it does to itself — culls, droughts, restarts — so those marks
   come from the island; everything the panel decides on its own is recorded here.
   Sliders are the deliberate exception: one mark per drag would bury the strip. */
function record(island, title, quick, detail) {
  const snap = latest.get(island);
  if (snap) noteMark(island, snap.tick, { title, quick, detail }, snap.stats);
}

/* One action is one moment, even though the three containers are not on the same
   generation. They are independent processes started a second or two apart and stay
   that way — measured at a steady twelve generations of offset — so stamping an
   archipelago-wide action with each island's own tick drew the same event at three
   different places on a shared axis, which reads as three events. It is recorded at
   the earliest tick any island has reached, so the mark always lands on curve that
   every band has already drawn rather than in some island's future. */
function recordAll(title, quick, detail) {
  const snaps = app.names.map(n => latest.get(n)).filter(Boolean);
  if (!snaps.length) return;
  const at = Math.min(...snaps.map(s => s.tick));
  for (const snap of snaps) {
    noteMark(snap.island, at, { title, quick, detail }, snap.stats);
  }
}

function markPreset(island, key, id) {
  if (!app.controls[island]) app.controls[island] = {};
  app.controls[island][key] = id;
  post("/control", { island, key, value: id });
}

/* Pause and resume are the `paused` parameter written to every island; restarting is
   a one-shot command each island answers by rebuilding its world. The engine reports
   the restart as an event, so the mark on the run strip comes from the island rather
   than from this click — it records what happened, not what was asked. */
export function runControl(id) {
  if (id !== "reset") {
    recordAll(id === "pause" ? "Paused" : "Resumed",
      id === "pause" ? "whole archipelago stopped" : "whole archipelago restarted",
      id === "pause"
        ? "Every island's clock was stopped at once. Nothing was lost; the containers stayed up and kept answering."
        : "Every island's clock was started again from exactly where it stopped.");
  }
  for (const island of app.names) {
    if (id === "reset") {
      post("/command", { island, op: "reset" });
    } else {
      const value = id === "pause" ? 1 : 0;
      if (!app.controls[island]) app.controls[island] = {};
      app.controls[island].paused = String(value);
      post("/control", { island, key: "paused", value });
    }
  }
}

/** The scenario the whole archipelago is on, or null when the islands disagree. */
export function activeScenario() {
  let found = null;
  for (const name of app.names) {
    const id = (app.controls[name] || {}).scenario || "";
    if (!id) return null;
    if (found === null) found = id;
    else if (found !== id) return null;
  }
  return found;
}

/* A hand-moved slider or switch means the island is no longer exactly the preset it
   was set to, and the archipelago is no longer exactly the scenario. Saying so is
   the point of the highlight; leaving it lit would make it decoration. */
export function clearPreset(island) {
  if (island) markPreset(island, "environment", "");
  for (const name of app.names) {
    if ((app.controls[name] || {}).scenario) markPreset(name, "scenario", "");
  }
  for (const btn of panelBody.querySelectorAll(".preset")) btn.setAttribute("aria-pressed", "false");
}


/* What an island is actually running with, and what it booted with. The live value
   comes from the island's own snapshot rather than the Redis hash, because the hash
   only holds keys somebody has explicitly written and a fresh island has none. */
function currentValue(name, key) {
  const live = app.controls[name] || {};
  const value = live[key];
  if (value === undefined || value === null || value === "") {
    const fallback = (app.defaults[name] || {})[key];
    return fallback === undefined ? PARAMS[key].min : Number(fallback);
  }
  return Number(value);
}

function defaultValue(name, key) {
  const fallback = (app.defaults[name] || {})[key];
  return fallback === undefined ? null : Number(fallback);
}

function paintKnob(row, key, value) {
  const p = PARAMS[key];
  const input = row.querySelector("input");
  const out = row.querySelector(".knob-figure");
  input.style.setProperty("--fill", ((value - p.min) / (p.max - p.min) * 100).toFixed(2) + "%");
  out.textContent = value.toFixed(p.dec) + p.unit;
}

const BACK_ARROW = '<svg width="13" height="11" viewBox="0 0 13 11" fill="none" aria-hidden="true">' +
  '<path d="M5.5 1L1 5.5L5.5 10M1 5.5h11" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* The resting state is a deck of separate floating cards, not one panel with cards
   inside it: the archipelago, then one per island. Each card is the thing it
   describes and opens what belongs to it — scenarios are archipelago-wide, so they
   live behind the archipelago card, and the parameters that shape one ecosystem live
   behind that island's. Nothing that can change an ecosystem is on screen until you
   have said which ecosystem you mean. */
export function showDeck() {
  app.view = "deck";
  app.selected = null;
  for (const card of cards.values()) card.el.setAttribute("aria-pressed", "false");
  panel.hidden = true;
  deck.hidden = false;
  paintDeck();
  onLayoutChange(false);
}

export function paintDeck() {
  if (app.view !== "deck") return;

  const wanted = app.names.join(",");
  if (deck.dataset.built !== wanted) {
    deck.dataset.built = wanted;
    deck.innerHTML = "";

    const arch = document.createElement("button");
    arch.type = "button";
    arch.className = "deck-card deck-arch";
    arch.innerHTML = `<span class="deck-top">
        <span class="deck-name">Archipelago</span>
        <span class="deck-clock" id="deck-clock">
          <span class="deck-dot"></span>
          <span class="deck-gen" id="deck-gen">0</span>
          <span class="deck-genlabel" id="deck-genlabel">generation</span>
        </span>
      </span>
      <p class="deck-sub">Three containers, one ecosystem each, trading individuals through Redis. Open for scenarios.</p>
      <span class="deck-figs">
        <span><b class="fig-prey a-prey">0</b>prey</span>
        <span><b class="fig-pred a-pred">0</b>predators</span>
        <span><b class="fig-cross a-cross">0</b>crossings</span>
      </span>`;
    arch.addEventListener("click", openArchipelago);
    deck.appendChild(arch);

    for (const name of app.names) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "deck-card";
      card.dataset.island = name;
      card.innerHTML = `<span class="deck-top">
          <span class="deck-name">${name}</span>
          <span class="deck-flag" hidden></span>
          <span class="deck-go">steer</span>
        </span>
        <p class="deck-sub"></p>
        <span class="deck-figs">
          <span><b class="fig-prey d-prey">0</b>prey</span>
          <span><b class="fig-pred d-pred">0</b>predators</span>
          <span><b class="d-grass">0%</b>grass</span>
          <span><b class="fig-cross d-cross">0</b>landed alive</span>
        </span>`;
      card.addEventListener("click", () => select(name));
      deck.appendChild(card);
    }
  }

  // Figures are written in place rather than re-rendered, so a card cannot lose the
  // pointer hovering it four times a second.
  let prey = 0, pred = 0, crossed = 0;
  for (const name of app.names) {
    const snap = latest.get(name);
    if (!snap) continue;
    prey += snap.stats.prey;
    pred += snap.stats.predators;
    crossed += snap.stats.migrants_received;
  }
  const set = (sel, text) => { const el = deck.querySelector(sel); if (el) el.textContent = text; };
  set(".a-prey", figure(prey));
  set(".a-pred", figure(pred));
  set(".a-cross", figure(crossed));

  for (const card of deck.querySelectorAll(".deck-card[data-island]")) {
    const snap = latest.get(card.dataset.island);
    if (!snap) continue;
    const st = snap.stats;
    card.querySelector(".deck-sub").textContent = describe(app.controls[card.dataset.island]);
    card.querySelector(".d-prey").textContent = figure(st.prey);
    card.querySelector(".d-pred").textContent = figure(st.predators);
    card.querySelector(".d-grass").textContent = Math.round(st.grass * 100) + "%";
    card.querySelector(".d-cross").textContent = figure(st.immigrants_alive);
    const live = app.controls[card.dataset.island] || {};
    const flags = [];
    if (Number(live.paused)) flags.push("Paused");
    const strait = straitLabel(live.isolated);
    if (strait) flags.push(strait);
    const flag = card.querySelector(".deck-flag");
    flag.textContent = flags.join(" \u00b7 ");
    flag.hidden = !flags.length;
  }
}

/** The generation counter belongs to the archipelago, so it lives on its card. */
export function paintClock(tick, finished, lost) {
  const gen = document.getElementById("deck-gen");
  const clock = document.getElementById("deck-clock");
  const label = document.getElementById("deck-genlabel");
  if (!gen) return;
  gen.textContent = figure(tick);
  clock.className = "deck-clock" + (lost ? " is-lost" : finished ? " is-stopped" : "");
  label.textContent = lost ? "no answer" : finished ? "run finished" : "generation";
}

function panelHead(title, subtitle) {
  panelTop.innerHTML = `<div class="panel-title">
      <button class="panel-back" type="button" aria-label="Back to the archipelago">${BACK_ARROW}</button>
      <h2 class="panel-name">${title}</h2>
    </div>
    <p class="panel-biome">${subtitle}</p>
    <div class="tally" id="sel-tally"></div>`;
  panelTop.querySelector(".panel-back").addEventListener("click", showDeck);
  deck.hidden = true;
  panel.hidden = false;
}

/** Scenarios apply to every island at once, so they belong to the archipelago. */
export function openArchipelago() {
  const first = panel.hidden;
  app.view = "arch";
  app.selected = null;
  for (const card of cards.values()) card.el.setAttribute("aria-pressed", "false");
  panelHead("Archipelago", "Four ready-made experiments, applied to all three islands.");

  panelBody.innerHTML = "";
  const pre = section("presets", "Scenarios", "whole archipelago",
    "Each scenario re-sets the sliders on all three islands at once, so the archipelago can be pushed into a different ecology without knowing which number to reach for. Every island keeps its own starting environment underneath, so the three never become copies of each other. Move any slider on an island afterwards and you are off the scenario again.",
    true);
  const grid = document.createElement("div");
  grid.className = "presets";
  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    btn.dataset.scenario = preset.id;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("data-tip-title", preset.name);
    btn.setAttribute("data-tip", preset.help);
    btn.innerHTML = `<span class="preset-name">${preset.name}</span><span class="preset-note">${preset.note}</span>`;
    btn.addEventListener("click", () => applyPreset(preset));
    grid.appendChild(btn);
  }
  pre.body.appendChild(grid);
  panelBody.appendChild(pre.el);

  const runs = section("Run", "Run", "every island",
    "Pause, resume or restart the whole archipelago at once. Pausing stops the clock without losing anything; restarting sends every island back to generation zero with fresh populations, keeping whatever you have configured.",
    true);
  const bar = document.createElement("div");
  bar.className = "runbar";

  // One button, two states. A separate "resume" that does nothing whenever the run
  // is already going is a button that is wrong half the time.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "act";
  bar.appendChild(toggle);

  const wrap = document.createElement("div");
  wrap.className = "confirm-wrap";
  wrap.innerHTML = `<button class="icon-btn" type="button" aria-expanded="false"
      aria-label="Restart the run" data-tip-title="Restart the run"
      data-tip="Send every island back to generation zero with fresh populations and a new draw of random genomes. Your sliders, environments and scenario are kept — this restarts the run, it does not undo your configuration.">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path d="M12.5 7.5a5 5 0 1 1-1.6-3.67M12.6 1.6v3.1H9.5" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></button>
    <div class="confirm" hidden>
      <p><b>Restart the run?</b>Every island goes back to generation zero and the populations on screen are replaced. Your sliders and presets are kept, and the run so far stays in results.csv under its own run number.</p>
      <div class="confirm-row">
        <button type="button" class="confirm-no">Cancel</button>
        <button type="button" class="confirm-go">Restart</button>
      </div>
    </div>`;
  bar.appendChild(wrap);
  runs.body.appendChild(bar);
  panelBody.appendChild(runs.el);

  const opener = wrap.querySelector(".icon-btn");
  const confirm = wrap.querySelector(".confirm");
  const setOpen = open => {
    confirm.hidden = !open;
    opener.setAttribute("aria-expanded", String(open));
    if (open) document.addEventListener("click", dismiss);
    else document.removeEventListener("click", dismiss);
  };
  // Anywhere else dismisses it, so the guard cannot be left hanging open. The
  // listener lives only while the popover does: attaching one per open would leave a
  // handler behind on every detached panel this session builds.
  const dismiss = e => { if (!wrap.contains(e.target)) setOpen(false); };
  opener.addEventListener("click", e => { e.stopPropagation(); setOpen(confirm.hidden); });
  wrap.querySelector(".confirm-no").addEventListener("click", () => setOpen(false));
  wrap.querySelector(".confirm-go").addEventListener("click", () => {
    setOpen(false);
    runControl("reset");
  });

  function paintToggle() {
    const paused = app.names.length > 0 &&
      app.names.every(n => Number((app.controls[n] || {}).paused));
    toggle.textContent = paused ? "Resume all" : "Pause all";
    toggle.setAttribute("data-tip-title", paused ? "Resume all" : "Pause all");
    toggle.setAttribute("data-tip", paused
      ? "Start every island's clock again from exactly where it stopped. Nothing was lost while it was paused."
      : "Freeze every island at once. The containers stay up and keep answering, the clock simply stops advancing, so you can read a moment properly instead of chasing it at twelve generations a second.");
  }
  toggle.addEventListener("click", () => {
    const paused = app.names.every(n => Number((app.controls[n] || {}).paused));
    runControl(paused ? "resume" : "pause");
    paintToggle();
  });
  paintToggle();
  runToggle = paintToggle;

  paintPresetState();
  paintArchipelago();
  onLayoutChange(first);
}

let runToggle = null;

export function paintArchipelago() {
  if (app.view !== "arch") return;
  if (runToggle) runToggle();
  let prey = 0, pred = 0, crossed = 0;
  for (const name of app.names) {
    const snap = latest.get(name);
    if (!snap) continue;
    prey += snap.stats.prey;
    pred += snap.stats.predators;
    crossed += snap.stats.migrants_received;
  }
  const tally = document.getElementById("sel-tally");
  if (tally) tally.innerHTML = [
    ["fig-prey", figure(prey), "prey"],
    ["fig-pred", figure(pred), "predators"],
    ["fig-cross", figure(crossed), "crossings"]
  ].map(([tone, value, label]) =>
    `<div class="tally-cell"><b class="${tone}">${value}</b><span>${label}</span></div>`).join("");
}

export function applyPreset(preset) {
  // Layered on each island's own defaults, never flat across the archipelago: the
  // three environments have to stay different from one another.
  for (const island of app.names) {
    const start = app.defaults[island];
    if (!start) continue;
    const wanted = Object.assign({}, start, preset.set);
    if (!app.controls[island]) app.controls[island] = {};
    for (const [key, value] of Object.entries(wanted)) {
      app.controls[island][key] = value;
      post("/control", { island, key, value });
    }
    // A scenario overwrites every parameter, so whatever environment the island was
    // on is no longer true; the scenario becomes the thing it is set to.
    markPreset(island, "environment", "");
    markPreset(island, "scenario", preset.id);
  }
  recordAll("Scenario applied", preset.name.toLowerCase(),
    `The whole archipelago was set to the ${preset.name} scenario. ${preset.help}`);
  paintPresetState();
}

/** Repaint every preset button on screen from what the islands are actually set to. */
export function paintPresetState() {
  const scenario = activeScenario();
  for (const btn of panelBody.querySelectorAll(".preset[data-scenario]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.scenario === scenario));
  }
  const island = app.selected;
  const environment = island ? (app.controls[island] || {}).environment || "" : "";
  for (const btn of panelBody.querySelectorAll(".preset[data-environment]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.environment === environment));
  }
}

export function buildPanel(name) {
  panelBody.innerHTML = "";

  // -- environment -------------------------------------------------------
  // Six ready-made environments for this island alone. They only write parameters;
  // the caption above updates because it is derived from those parameters, so it
  // follows a preset and a hand-moved slider alike and can never contradict either.
  const env = section("Environment", "Environment", "this island",
    "Six ready-made environments for this island. Each one writes a set of parameters and nothing else — the description under the island's name is worked out from the parameters actually in force, so it follows whichever you pick, and keeps following it if you then move a slider by hand.",
    opened.has("Environment"));
  const envGrid = document.createElement("div");
  envGrid.className = "presets";
  for (const e of ENVIRONMENTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    btn.dataset.environment = e.id;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("data-tip-title", e.name);
    btn.setAttribute("data-tip", e.help);
    btn.innerHTML = `<span class="preset-name">${e.name}</span><span class="preset-note">${e.note}</span>`;
    btn.addEventListener("click", () => {
      if (!app.controls[name]) app.controls[name] = {};
      for (const [key, value] of Object.entries(e.set)) {
        app.controls[name][key] = value;
        post("/control", { island: name, key, value });
      }
      // Setting an environment overwrites parameters a scenario had put in place, so
      // the archipelago is no longer on that scenario; this island is on this
      // environment. Both facts are written down rather than assumed.
      for (const other of app.names) {
        if ((app.controls[other] || {}).scenario) markPreset(other, "scenario", "");
      }
      markPreset(name, "environment", e.id);
      record(name, "Environment set", e.name.toLowerCase(),
        `This island was set to the ${e.name} environment: ${e.help}`);
      buildPanel(name);
      const caption = panelTop.querySelector(".panel-biome");
      if (caption) caption.textContent = describe(app.controls[name]);
    });
    envGrid.appendChild(btn);
  }
  env.body.appendChild(envGrid);
  panelBody.appendChild(env.el);

  // -- parameters --------------------------------------------------------
  for (const group of GROUPS) {
    const sec = section(group.name, group.name, group.note, group.help, opened.has(group.name));

    for (const key of group.keys) {
      const p = PARAMS[key];
      const row = document.createElement("div");
      row.className = "knob";
      const value = currentValue(name, key);
      const def = defaultValue(name, key);
      row.innerHTML = `<div class="knob-top">
          <span class="knob-label">${p.label}</span>
          ${infoTag(p.help, p.label, p.ref)}
          <span class="knob-value"><span class="knob-moved" title="moved from this island's starting value"></span><span class="knob-figure"></span></span>
        </div>
        <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}"
               aria-label="${p.label} on ${name}">`;
      const input = row.querySelector("input");
      paintKnob(row, key, value);
      if (def !== null) row.classList.toggle("is-moved", Math.abs(value - def) > p.step / 2);
      input.addEventListener("input", () => {
        const now = Number(input.value);
        paintKnob(row, key, now);
        if (def !== null) row.classList.toggle("is-moved", Math.abs(now - def) > p.step / 2);
        if (!app.controls[name]) app.controls[name] = {};
        app.controls[name][key] = input.value;
        post("/control", { island: name, key, value: input.value });
        clearPreset(name);
      });
      sec.body.appendChild(row);
    }
    panelBody.appendChild(sec.el);
  }

  // -- island state ------------------------------------------------------
  const state = section("Island state", "Island state", "",
    "What this container does, rather than what its ecosystem is like. Both take effect on the very next generation.",
    opened.has("Island state"));

  // The strait is four states, not a switch, because leaving and arriving are
  // separate questions and the interesting cases are the asymmetric ones.
  const straitLabelEl = document.createElement("div");
  straitLabelEl.className = "field-label";
  straitLabelEl.innerHTML = `<span>The strait</span>${infoTag(
    "Whether individuals can leave this island, land on it, both or neither. Shutting one direction only is the interesting case: an island that sends but never receives evolves entirely on its own while still seeding its neighbours, and one that receives but never sends collects everyone else's genes and gives nothing back.",
    "The strait")}`;
  state.body.appendChild(straitLabelEl);

  const straitGrid = document.createElement("div");
  straitGrid.className = "presets segmented";
  straitGrid.setAttribute("role", "radiogroup");
  straitGrid.setAttribute("aria-label", `Strait on ${name}`);
  const current = Number((app.controls[name] || {}).isolated || 0) | 0;
  for (const mode of STRAIT) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(mode.value === current));
    btn.setAttribute("data-tip-title", mode.name);
    btn.setAttribute("data-tip", mode.help);
    btn.innerHTML = `<span class="preset-name">${mode.name}</span><span class="preset-note">${mode.note}</span>`;
    btn.addEventListener("click", () => {
      for (const other of straitGrid.children) other.setAttribute("aria-checked", "false");
      btn.setAttribute("aria-checked", "true");
      if (!app.controls[name]) app.controls[name] = {};
      app.controls[name].isolated = String(mode.value);
      post("/control", { island: name, key: "isolated", value: mode.value });
      record(name, "Strait changed", mode.name.toLowerCase(),
        `The strait on this island was set to "${mode.name}". ${mode.help}`);
    });
    straitGrid.appendChild(btn);
  }
  state.body.appendChild(straitGrid);

  for (const sw of SWITCHES) {
    const on = !!Number((app.controls[name] || {})[sw.key]);
    const row = document.createElement("div");
    row.className = "toggle";
    row.innerHTML = `<span class="toggle-label">${sw.label}</span>
      ${infoTag(sw.help, sw.label)}
      <button class="switch" type="button" role="switch" aria-checked="${on}"
              aria-label="${sw.label} on ${name}"><i></i></button>`;
    const knob = row.querySelector(".switch");
    knob.addEventListener("click", () => {
      const next = knob.getAttribute("aria-checked") !== "true";
      knob.setAttribute("aria-checked", String(next));
      if (!app.controls[name]) app.controls[name] = {};
      app.controls[name][sw.key] = next ? "1" : "0";
      post("/control", { island: name, key: sw.key, value: next ? 1 : 0 });
      record(name, next ? "Paused" : "Resumed",
        next ? "this island's clock stopped" : "this island's clock restarted",
        next
          ? "This island's clock was stopped. Its neighbours kept running, so anything they sent while it was frozen was waiting for it when it started again."
          : "This island's clock was started again from exactly where it stopped.");
    });
    state.body.appendChild(row);
  }
  panelBody.appendChild(state.el);

  // -- interventions -----------------------------------------------------
  const acts = section("Interventions", "Interventions", "one-off",
    "One-off shocks, applied immediately and never repeated. Each one leaves a tick on the run strip below, so you can line the mark up against what the populations did next.",
    opened.has("Interventions"));
  const actGrid = document.createElement("div");
  actGrid.className = "acts";
  for (const a of ACTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "act";
    btn.setAttribute("data-tip", a.help);
    btn.setAttribute("data-tip-title", a.label);
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      // No mark from here: the island publishes an event for what actually happened,
      // including how many individuals it really affected, and that is what the run
      // strip records.
      post("/command", Object.assign({ island: name, op: a.op }, a.body));
    });
    actGrid.appendChild(btn);
  }
  acts.body.appendChild(actGrid);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost";
  reset.textContent = "Restore this island's starting values";
  reset.setAttribute("data-tip-title", "Restore");
  reset.setAttribute("data-tip", "Put every slider and switch on this island back to the value its container booted with. The three islands do not start from the same place — each one is configured differently in docker-compose.yml — so this restores its own, not a shared default.");
  reset.addEventListener("click", () => {
    const start = app.defaults[name];
    if (!start) return;
    if (!app.controls[name]) app.controls[name] = {};
    for (const [key, value] of Object.entries(start)) {
      app.controls[name][key] = value;
      post("/control", { island: name, key, value });
    }
    clearPreset(name);
    record(name, "Defaults restored", "back to this island's boot values",
      "Every slider and switch on this island was put back to the value its container booted with. The three islands do not start from the same place \u2014 each is configured differently in docker-compose.yml \u2014 so this restored its own, not a shared default.");
    buildPanel(name);
  });
  acts.body.appendChild(reset);
  panelBody.appendChild(acts.el);

  // -- readouts ----------------------------------------------------------
  const flux = section("Since the run began", "Since the run began", "",
    "Running totals for the whole run, not figures for the current generation. Together they say how this island has been living: mostly starving, mostly hunted, or mostly dying of old age.",
    opened.has("Since the run began"));
  flux.body.innerHTML = '<dl class="readout" id="sel-flux"></dl>';
  panelBody.appendChild(flux.el);

  const genes = section("Mean genes", "Mean genes", "prey over predators",
    "The average of each gene across everyone alive on this island right now, on a scale of nought to one. The upper bar is prey, the lower one predators. Watch these drift apart between islands: that is evolution responding to three different environments, and it is what the migrants carry across the sea.",
    opened.has("Mean genes"));
  genes.body.innerHTML = '<div id="sel-genes"></div>';
  panelBody.appendChild(genes.el);

  const cross = section("Crossings", "Crossings", "",
    "Proof that the containers are talking. Every island reaches every other island directly, so there is one line here per neighbour. 'Landed alive' counts only individuals that personally crossed the sea and are still breathing; 'foreign lineage' counts them and their descendants, who were born here but carry a parent's origin. They are different numbers and the difference is the point.",
    opened.has("Crossings"));
  cross.body.innerHTML = '<dl class="readout" id="sel-cross"></dl>';
  panelBody.appendChild(cross.el);
}

// Which sections are open. Kept outside buildPanel so switching island, applying a
// preset or restoring defaults does not throw away how the person arranged the panel.
const opened = new Set(["presets", "Environment"]);

function section(id, title, note, help, open) {
  const el = document.createElement("section");
  el.className = "group";
  el.dataset.open = String(open);
  el.innerHTML = `<div class="group-head">
      <button class="group-toggle" type="button" aria-expanded="${open}">
        <svg class="group-caret" width="6" height="9" viewBox="0 0 6 9" fill="none" aria-hidden="true">
          <path d="M1 1l4 3.5L1 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="group-name">${title}</span>
      </button>
      ${help ? infoTag(help, title) : ""}
      ${note ? `<span class="group-note">${note}</span>` : ""}
    </div>
    <div class="group-body"></div>`;
  const toggle = el.querySelector(".group-toggle");
  toggle.addEventListener("click", () => {
    const next = el.dataset.open !== "true";
    el.dataset.open = String(next);
    toggle.setAttribute("aria-expanded", String(next));
    next ? opened.add(id) : opened.delete(id);
  });
  return { el, body: el.querySelector(".group-body") };
}

function readout(target, rows) {
  target.innerHTML = rows.map(([label, value, tone]) =>
    `<dt>${label}</dt><dd${tone ? ` class="fig-${tone}"` : ""}>${value}</dd>`).join("");
}

export function select(name) {
  if (!cards.has(name)) return;
  const first = panel.hidden;
  app.view = "island";
  app.selected = name;
  for (const [other, card] of cards) card.el.setAttribute("aria-pressed", String(other === name));
  panelHead(name, describe(app.controls[name]));
  buildPanel(name);
  const snap = latest.get(name);
  if (snap) paintPanel(snap);
  onLayoutChange(first);
}

export function paintPanel(snap) {
  const s = snap.stats;
  const caption = panelTop.querySelector(".panel-biome");
  if (caption) caption.textContent = describe(app.controls[snap.island]);
  paintPresetState();

  // A scenario, another browser window or a restart can move these; the panel is a
  // view of the island's state, not a memory of what was last clicked in it.
  const current = Number((app.controls[snap.island] || {}).isolated || 0) | 0;
  panelBody.querySelectorAll(".segmented .preset").forEach((btn, i) => {
    btn.setAttribute("aria-checked", String(STRAIT[i] && STRAIT[i].value === current));
  });
  for (const knob of panelBody.querySelectorAll(".switch[role=switch]")) {
    const key = knob.getAttribute("aria-label").startsWith("Pause") ? "paused" : null;
    if (key) knob.setAttribute("aria-checked", String(!!Number((app.controls[snap.island] || {})[key])));
  }
  document.getElementById("sel-tally").innerHTML = [
    ["fig-prey", figure(s.prey), "prey"],
    ["fig-pred", figure(s.predators), "predators"],
    ["", Math.round(s.grass * 100) + "%", "grass"]
  ].map(([tone, value, label]) =>
    `<div class="tally-cell"><b class="${tone}">${value}</b><span>${label}</span></div>`).join("");

  const flux = document.getElementById("sel-flux");
  if (flux) readout(flux, [
    ["Births", figure(s.births)],
    ["Starved", figure(s.deaths_starved)],
    ["Taken by predators", figure(s.deaths_predated)],
    ["Died of old age", figure(s.deaths_old)]
  ]);

  const genes = document.getElementById("sel-genes");
  if (genes) genes.innerHTML = TRAITS.map(t => {
    const prey = s["prey_" + t.key], pred = s["pred_" + t.key];
    return `<div class="gene">
      <span class="gene-label">${t.label}${infoTag(t.help, t.label)}</span>
      <div>
        <div class="gene-track"><i class="gene-fill prey" style="width:${(prey * 100).toFixed(0)}%"></i></div>
        <div class="gene-track"><i class="gene-fill pred" style="width:${(pred * 100).toFixed(0)}%"></i></div>
      </div>
      <span class="gene-figs"><b class="prey">${prey.toFixed(2)}</b><b class="pred">${pred.toFixed(2)}</b></span>
    </div>`;
  }).join("");

  const others = (snap.neighbors || []).filter(n => cards.has(n));
  const rows = [
    ["Landed alive", figure(s.immigrants_alive), "cross"],
    ["Foreign lineage", figure(s.foreign_prey + s.foreign_predators), "cross"],
    ["Sent, all time", figure(s.migrants_sent)],
    ["Taken in, all time", figure(s.migrants_received)]
  ];
  for (const other of others) {
    rows.push([`Sent to ${other}`, figure(Math.round(s.migrants_sent / others.length))]);
  }
  const cross = document.getElementById("sel-cross");
  if (cross) readout(cross, rows);
}
