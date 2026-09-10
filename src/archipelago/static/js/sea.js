/* The sea: laying the archipelago out, painting each island, and the travellers.

   Owns everything that happens on the water and nothing that happens in the panel.
   `onSelect` is injected by app.js rather than imported from panel.js, which is what
   keeps these two modules off each other's import list. */

import { DPR, cards, rafts, latest, app, figure } from "./state.js";
import { PALETTE } from "./palette.js";
import { describe, straitLabel } from "./params.js";

const sea = document.getElementById("sea");
const routes = document.getElementById("routes");
const deck = document.getElementById("deck");
const panel = document.getElementById("panel");
const timeline = document.getElementById("timeline");
const rctx = routes.getContext("2d");

let onSelect = () => {};
export function setSelectHandler(fn) { onSelect = fn; }

let labelHeight = 60;

export function water() {
  const w = sea.clientWidth, h = sea.clientHeight;
  const g = 18;
  // Whichever of the two right-hand surfaces is currently up: the deck of cards at
  // rest, the panel once something has been opened. There is no bar along the top
  // any more, so the only thing above the archipelago is the gutter.
  const column = panel.hidden ? deck : panel;
  const right = column.hidden ? g : column.getBoundingClientRect().width + g * 2;
  const bottom = timeline.getBoundingClientRect().height + g * 2;
  return {
    x: g,
    y: g,
    w: Math.max(160, w - g - right),
    h: Math.max(160, h - g - bottom)
  };
}

function ring(i, n, box, rx, ry) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (n === 1) return { x: cx, y: cy };
  const start = n === 2 ? 0 : -Math.PI / 2;
  const a = start + i * 2 * Math.PI / n;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}

function collides(n, size, box, rx, ry) {
  const bw = 64 * size, bh = 40 * size + labelHeight;
  const spots = [];
  for (let i = 0; i < n; i++) {
    const p = ring(i, n, box, rx, ry);
    if (p.x - bw / 2 < box.x || p.x + bw / 2 > box.x + box.w) return true;
    if (p.y - bh / 2 < box.y || p.y + bh / 2 > box.y + box.h) return true;
    spots.push(p);
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      // Asymmetric padding on purpose: two islands sitting side by side need real
      // water between them, while a diagonal pair whose boxes barely overlap on one
      // axis is already far apart on the screen.
      if (Math.abs(spots[i].x - spots[j].x) < bw + 40 &&
          Math.abs(spots[i].y - spots[j].y) < bh + 14) return true;
    }
  }
  return false;
}

function plan(n, box) {
  for (const size of [8, 7, 6, 5, 4, 3]) {
    const rx = box.w / 2 - 64 * size / 2;
    const ry = box.h / 2 - (40 * size + labelHeight) / 2;
    // Spreading the constellation as wide as the water allows can only separate the
    // islands further, so there is exactly one arrangement worth testing per size:
    // the widest one. The first size that fits is the largest raster that fits.
    if (rx > 0 && ry > 0 && !collides(n, size, box, rx, ry)) return { size, rx, ry };
  }
  return { size: 3, rx: Math.max(24, box.w / 2 - 100), ry: Math.max(24, box.h / 2 - 80) };
}

function buildIsland(name) {
  const el = document.createElement("button");
  el.className = "isle";
  el.type = "button";
  el.setAttribute("aria-pressed", "false");
  el.setAttribute("aria-label", `${name}: select to inspect and steer it`);
  el.innerHTML = `
    <span class="isle-raster">
      <canvas></canvas>
      <span class="isle-badge" hidden></span>
    </span>
    <span class="isle-label">
      <span class="isle-head">
        <span class="isle-name">${name}</span>
        <span class="isle-counts">
          <span><b class="c-prey">0</b> prey</span>
          <span><b class="c-pred">0</b> predators</span>
        </span>
      </span>
      <p class="isle-biome"></p>
    </span>`;
  // A canvas with no size still claims 300x150, which would spoil the measurement
  // of the label below it.
  const canvas = el.querySelector("canvas");
  canvas.style.width = "0px";
  canvas.style.height = "0px";
  el.addEventListener("click", () => onSelect(name));
  sea.appendChild(el);
  return el;
}

function buildRaster(snap, el) {
  const canvas = el.querySelector("canvas");
  canvas.width = snap.width * app.cell * DPR;
  canvas.height = snap.height * app.cell * DPR;
  canvas.style.width = snap.width * app.cell + "px";
  canvas.style.height = snap.height * app.cell + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const buffer = document.createElement("canvas");
  buffer.width = snap.width;
  buffer.height = snap.height;
  const bctx = buffer.getContext("2d");
  return { el, canvas, ctx, buffer, bctx, image: bctx.createImageData(snap.width, snap.height) };
}

export function rebuild(snapshots) {
  cards.clear();
  rafts.length = 0;
  app.geometry = null;
  sea.querySelectorAll(".isle").forEach(node => node.remove());
  const built = snapshots.map(snap => buildIsland(snap.island));
  if (built.length) labelHeight = Math.max(30, Math.round(built[0].getBoundingClientRect().height));
  const box = water();
  const shape = app.stacked ? { size: 6 } : plan(snapshots.length, box);
  app.cell = shape.size;
  snapshots.forEach((snap, i) => {
    const el = built[i];
    if (!app.stacked) {
      const at = ring(i, snapshots.length, box, shape.rx, shape.ry);
      el.style.left = at.x + "px";
      el.style.top = at.y + "px";
      // An island in the upper half of the ring wears its label above, so the text
      // always sits on the outside of the constellation rather than in the middle of
      // the water, where the travellers cross. Positional rather than by name, so it
      // still holds if the archipelago ever has four islands.
      el.classList.toggle("label-above", at.y < box.y + box.h / 2);
    }
    cards.set(snap.island, buildRaster(snap, el));
  });
  document.getElementById("waiting").hidden = true;
}

/* ---- painting one island — unchanged: same pixels, same palette ---- */

function paintAgents(ctx, agents, size) {
  for (const [x, y, species, speed, , , , crossed] of agents) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, species === 1 ? size * 0.42 : size * 0.29, 0, 6.2832);
    ctx.fillStyle = species === 1
      ? `rgb(${216 + speed * 4}, ${86 + speed * 3}, 60)`
      : `rgb(${226 + speed * 3}, ${178 + speed * 5}, ${84 + speed * 4})`;
    ctx.fill();
    if (crossed) {
      ctx.strokeStyle = "#7fb2ff";
      ctx.lineWidth = Math.max(1, size * 0.17);
      ctx.stroke();
    }
  }
}

export function paintIsland(snap) {
  const card = cards.get(snap.island);
  if (!card) return;
  const { ctx, image, bctx, buffer } = card;
  let p = 0;
  for (let y = 0; y < snap.height; y++) {
    const row = snap.grass[y];
    for (let x = 0; x < snap.width; x++) {
      const g = (row.charCodeAt(x) - 48) / 9;
      image.data[p++] = 22 + g * 54;
      image.data[p++] = 36 + g * 118;
      image.data[p++] = 31 + g * 55;
      image.data[p++] = 255;
    }
  }
  bctx.putImageData(image, 0, 0);
  ctx.drawImage(buffer, 0, 0, snap.width * app.cell, snap.height * app.cell);
  paintAgents(ctx, snap.agents, app.cell);

  const s = snap.stats;
  const el = card.el;
  el.querySelector(".c-prey").textContent = figure(s.prey);
  el.querySelector(".c-pred").textContent = figure(s.predators);
  const live = app.controls[snap.island] || {};
  const flags = [];
  if (Number(live.paused)) flags.push("Paused");
  const strait = straitLabel(live.isolated);
  if (strait) flags.push(strait);
  el.querySelector(".isle-biome").textContent = describe(live);
  const badge = el.querySelector(".isle-badge");
  badge.textContent = flags.join(" · ");
  badge.hidden = !flags.length;
}

/* ---- crossings ------------------------------------------------------------
   The sea is drawn empty. There is no permanent lane between two islands, because
   there is no permanent thing there: the only marks on the water are individuals
   that are crossing it at that moment, and when nothing is migrating — a closed
   strait, a wave size of nought, the gap between two waves — the sea is blank and
   that blankness is the reading. The all-time crossing figures live in the panel,
   where a number belongs.

   Every island reaches every other island directly, so a departure is dealt out to
   its neighbours in the same round-robin order the container uses. */

export function measure() {
  const box = sea.getBoundingClientRect();
  const out = new Map();
  for (const [name, card] of cards) {
    const r = card.canvas.getBoundingClientRect();
    out.set(name, {
      cx: r.left + r.width / 2 - box.left, cy: r.top + r.height / 2 - box.top,
      hw: r.width / 2, hh: r.height / 2
    });
  }
  return out;
}

// Where the route leaves a raster: the point the line crosses that rectangle's edge.
function exitPoint(from, dx, dy, gap) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const t = Math.min(
    Math.abs(ux) > 1e-6 ? (from.hw + gap) / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? (from.hh + gap) / Math.abs(uy) : Infinity
  );
  return { x: from.cx + ux * t, y: from.cy + uy * t };
}

function routeCurve(a, b) {
  const p0 = exitPoint(a, b.cx - a.cx, b.cy - a.cy, 10);
  const p2 = exitPoint(b, a.cx - b.cx, a.cy - b.cy, 10);
  const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2;
  const dx = p2.x - p0.x, dy = p2.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = len * 0.07;
  return { p0, p2, p1: { x: mx - dy / len * bow, y: my + dx / len * bow } };
}

function onCurve(c, t) {
  const u = 1 - t;
  return {
    x: u * u * c.p0.x + 2 * u * t * c.p1.x + t * t * c.p2.x,
    y: u * u * c.p0.y + 2 * u * t * c.p1.y + t * t * c.p2.y
  };
}

export function launch(from, count) {
  const snap = latest.get(from);
  if (!snap) return;
  const others = (snap.neighbors || []).filter(n => cards.has(n));
  if (!others.length) return;
  // One dot per individual that really left, dealt out the way island.py deals them:
  // round-robin across every other island. Capped only so a slider dragged to 20
  // cannot bury the sea.
  for (let i = 0; i < Math.min(count, 24); i++) {
    rafts.push({ from, to: others[i % others.length], t: -i * 0.05 });
  }
}

export function drawTravellers() {
  const w = sea.clientWidth, h = sea.clientHeight;
  if (routes.width !== Math.round(w * DPR) || routes.height !== Math.round(h * DPR)) {
    routes.width = Math.round(w * DPR);
    routes.height = Math.round(h * DPR);
    routes.style.width = w + "px";
    routes.style.height = h + "px";
    app.geometry = null;
  }
  rctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  rctx.clearRect(0, 0, w, h);
  if (app.stacked || !rafts.length) return;
  if (!app.geometry) app.geometry = measure();

  for (let i = rafts.length - 1; i >= 0; i--) {
    const raft = rafts[i];
    raft.t += 0.019;
    if (raft.t > 1) { rafts.splice(i, 1); continue; }
    if (raft.t < 0) continue;
    const a = app.geometry.get(raft.from), b = app.geometry.get(raft.to);
    if (!a || !b) { rafts.splice(i, 1); continue; }
    const curve = routeCurve(a, b);
    // Fade in off one shore and out onto the other, so a traveller is never a dot
    // that pops into existence at the edge of a raster.
    const fade = Math.sin(raft.t * Math.PI);
    for (let k = 0; k < 5; k++) {
      const at = onCurve(curve, Math.max(0, raft.t - k * 0.020));
      rctx.beginPath();
      rctx.arc(at.x, at.y, 3.4 - k * 0.55, 0, 6.2832);
      rctx.globalAlpha = fade * (0.9 - k * 0.17);
      rctx.fillStyle = PALETTE.cross;
      rctx.fill();
    }
    rctx.globalAlpha = 1;
  }
}

export function animate() {
  drawTravellers();
  requestAnimationFrame(animate);
}
