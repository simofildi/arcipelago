/* The run strip: one band per island, each species drawn against its own ceiling.

   Three things share this canvas — the lines, the intervention marks, and the
   pointer. The pointer is why the strip freezes on hover: a chart that rescales four
   times a second is impossible to aim at, so while the pointer is over it the domain
   is held still and the incoming samples simply queue up behind it. */

import { DPR, series, marks, app, figure } from "./state.js";
import { PALETTE } from "./palette.js";
import { WINDOWS } from "./params.js";
import { openTipAt, closeTip, tipIsPinned } from "./tooltip.js";

const timeline = document.getElementById("timeline");
const runCanvas = document.getElementById("run");
const runCtx = runCanvas.getContext("2d");

/** Record an intervention. `info` is {title, quick, detail} — see describeEvent. */
export function noteMark(island, tick, info, stats) {
  marks.push({
    island, tick,
    title: info.title, quick: info.quick, detail: info.detail,
    prey: stats ? stats.prey : null,
    pred: stats ? stats.predators : null
  });
  if (marks.length > 240) marks.shift();
}

// Where each mark and each band was last drawn, so the pointer can find them.
// Rebuilt every frame rather than derived on demand: the strip rescales as the run
// grows, and a stale hit box would point at the wrong generation.
const hits = [];
const bands = [];
let hovered = null;      // the mark under the pointer
let cursor = null;       // {x, tick} while the pointer is over the plot
let frozen = null;       // {first, last} held still while the pointer is over it
let plot = null;         // the current geometry, for hit testing

function span() {
  return (WINDOWS.find(w => w.id === app.window) || WINDOWS[1]).span;
}

/* A window wider than the strip's own domain draws exactly the same picture as every
   wider one, which makes the control look broken when it is merely early. Saying how
   much there is to show is the difference between a dead button and an honest one.

   It takes two numbers because the honest sentence needs both. `spanned` is what the
   axis covers and is therefore what decides whether this window changes anything;
   `perIsland` is what any one band actually holds. They differ by the offset between
   the islands, which is tens of generations on a long run, so quoting the first as
   though it were history recorded would overstate every band on the strip. */
function markWindowsAvailable(spanned, perIsland) {
  const bar = document.getElementById("run-window");
  if (!bar) return;
  const offset = spanned - perIsland >= 1
    ? ` \u2014 ${figure(Math.round(perIsland))} of them on any one island, plus the offset between them`
    : "";
  for (const btn of bar.children) {
    const option = WINDOWS.find(w => w.id === btn.dataset.window);
    if (!option) continue;
    const short = option.span > 0 && spanned < option.span;
    btn.classList.toggle("is-short", short);
    btn.title = short
      ? `The strip spans ${figure(Math.round(spanned))} generations so far${offset}, ` +
        `so this window shows exactly what All shows until the page has watched for longer.`
      : "";
  }
}

export function drawRun() {
  if (timeline.classList.contains("is-shut")) return;
  const w = runCanvas.clientWidth, h = runCanvas.clientHeight;
  if (!w) return;
  if (runCanvas.width !== Math.round(w * DPR) || runCanvas.height !== Math.round(h * DPR)) {
    runCanvas.width = Math.round(w * DPR);
    runCanvas.height = Math.round(h * DPR);
  }
  runCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  runCtx.clearRect(0, 0, w, h);
  if (!app.names.length) return;

  /* The domain is the union of what the islands cover, never the intersection: a band
     that starts late or stops early is telling the truth about an independent
     container, and clipping the axis to the overlap would hide real samples at both
     ends. `shortest` is what one band holds, which is the union minus the offset
     between the islands, and is the number the window control has to quote.

     Every series is pushed in poll order and emptied on a restart, so it is sorted
     and both ends are already known: this used to scan every sample of every island
     to find them, four times a second and again on each pointer move. */
  let earliest = Infinity, last = 0, shortest = Infinity;
  for (const name of app.names) {
    const line = series.get(name);
    if (!line || !line.length) continue;
    const from = line[0][0], to = line[line.length - 1][0];
    earliest = Math.min(earliest, from);
    last = Math.max(last, to);
    shortest = Math.min(shortest, to - from);
  }
  if (!isFinite(earliest) || last <= earliest) return;

  // The window the person chose, unless the pointer is holding the strip still.
  let first = earliest;
  const width = span();
  if (width > 0) first = Math.max(earliest, last - width);
  if (frozen) { first = frozen.first; last = frozen.last; }
  if (last <= first) return;

  /* One ceiling, shared by both species and by every band, taken from the window on
     screen so a spike that has scrolled off stops flattening what follows it.

     Prey and predators used to be drawn against their own peaks, so the predator
     line would not lie near the floor. The cost was that vertical position meant
     nothing: an island with 456 prey and 277 predators drew the predator line at 91
     per cent of the band and the prey line at 37, which reads as "more predators
     than prey" and is false. A chart whose y axis cannot be compared with itself is
     worse than one where a small population honestly looks small. */
  let peak = 1;
  for (const name of app.names) {
    for (const [tick, prey, pred] of series.get(name) || []) {
      if (tick < first || tick > last) continue;
      peak = Math.max(peak, prey, pred);
    }
  }

  markWindowsAvailable(last - earliest, shortest);
  document.getElementById("run-span").innerHTML =
    `<span>generation ${figure(first)} to ${figure(last)}</span>` +
    `<span>peak <b class="k-tick">${figure(peak)}</b> individuals</span>`;

  const left = 62, right = 74, axis = 16;
  const plotW = w - left - right;
  const bandGap = 8;
  const bandH = (h - axis - bandGap * (app.names.length - 1)) / app.names.length;
  const x = tick => left + plotW * (tick - first) / (last - first);
  const tickAt = px => first + (last - first) * (px - left) / plotW;
  plot = { left, right, plotW, axis, bandH, bandGap, first, last, x, tickAt, height: h };

  hits.length = 0;
  bands.length = 0;
  app.names.forEach((name, i) => {
    const top = i * (bandH + bandGap);
    const base = top + bandH;
    const y = v => base - (bandH - 7) * v / (peak * 1.06);
    bands.push({ name, top, base });

    runCtx.fillStyle = PALETTE.recess;
    if (runCtx.roundRect) {
      runCtx.beginPath();
      runCtx.roundRect(left, top, plotW, bandH, 5);
      runCtx.fill();
    } else {
      runCtx.fillRect(left, top, plotW, bandH);
    }

    runCtx.font = "500 11px " + PALETTE.sans;
    runCtx.fillStyle = name === app.selected ? PALETTE.fg : PALETTE["fg-muted"];
    runCtx.textAlign = "left";
    runCtx.textBaseline = "middle";
    runCtx.fillText(name, 0, top + bandH / 2);

    for (const mark of marks) {
      if (mark.island !== name || mark.tick < first || mark.tick > last) continue;
      const mx = x(mark.tick);
      const lit = mark === hovered;
      runCtx.globalAlpha = lit ? 0.9 : 0.32;
      runCtx.fillStyle = PALETTE.fg;
      runCtx.fillRect(mx, top, 1, bandH);
      runCtx.globalAlpha = 1;
      runCtx.fillRect(mx - (lit ? 2.5 : 1.5), top, lit ? 6 : 4, lit ? 4 : 3);
      hits.push({ mark, x: mx, top, bottom: base });
    }

    const line = series.get(name) || [];
    runCtx.lineJoin = "round";
    for (const [field, colour, width2, scale] of
         [["prey", PALETTE["prey-line"], 1.9, y], ["pred", PALETTE["pred-line"], 1.9, y]]) {
      runCtx.beginPath();
      let started = false;
      for (const [tick, prey, pred] of line) {
        if (tick < first || tick > last) continue;
        const at = scale(field === "prey" ? prey : pred);
        started ? runCtx.lineTo(x(tick), at) : runCtx.moveTo(x(tick), at);
        started = true;
      }
      runCtx.strokeStyle = colour;
      runCtx.lineWidth = width2;
      runCtx.stroke();
    }

    // The reading in the right gutter: the last sample, or the sample under the
    // pointer when there is one, so the cursor answers "what was it here".
    const sample = cursor ? sampleAt(name, cursor.tick) : lastSample(name);
    if (sample) {
      runCtx.font = "500 10.5px " + PALETTE.figures;
      runCtx.textAlign = "left";
      runCtx.fillStyle = PALETTE["prey-line"];
      runCtx.fillText(figure(sample[1]), left + plotW + 7, top + bandH / 2 - 6);
      runCtx.fillStyle = PALETTE["pred-line"];
      runCtx.fillText(figure(sample[2]), left + plotW + 7, top + bandH / 2 + 7);
      if (cursor) {
        for (const [value, colour, scale] of
             [[sample[1], PALETTE["prey-line"], y], [sample[2], PALETTE["pred-line"], y]]) {
          runCtx.beginPath();
          runCtx.arc(cursor.x, scale(value), 3, 0, 6.2832);
          runCtx.fillStyle = colour;
          runCtx.fill();
        }
      }
    }

    // One axis, so one ceiling, in neutral ink: it belongs to the band, not to a
    // species. Height now means the same thing everywhere on the strip.
    runCtx.font = "400 9.5px " + PALETTE.figures;
    runCtx.textAlign = "right";
    runCtx.fillStyle = PALETTE["fg-faint"];
    runCtx.fillText(figure(Math.round(peak * 1.06)), left - 5, top + 6);
    runCtx.fillText("0", left - 5, base - 3);
  });

  if (cursor) {
    runCtx.globalAlpha = 0.5;
    runCtx.strokeStyle = PALETTE.fg;
    runCtx.lineWidth = 1;
    runCtx.beginPath();
    runCtx.moveTo(cursor.x, 0);
    runCtx.lineTo(cursor.x, h - axis);
    runCtx.stroke();
    runCtx.globalAlpha = 1;
  }

  runCtx.font = "400 10px " + PALETTE.figures;
  runCtx.fillStyle = PALETTE["fg-faint"];
  runCtx.textBaseline = "top";
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const tick = first + (last - first) * i / ticks;
    const tx = x(tick);
    // The cursor's own label is the one being read, so a fixed tick that would
    // collide with it is dropped rather than printed on top of it.
    if (cursor && Math.abs(tx - cursor.x) < 34) continue;
    runCtx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
    runCtx.fillText(figure(Math.round(tick)), tx, h - axis + 3);
  }
  if (cursor) {
    runCtx.textAlign = "center";
    runCtx.fillStyle = PALETTE.fg;
    runCtx.fillText(figure(Math.round(cursor.tick)), cursor.x, h - axis + 3);
  }
  runCtx.textAlign = "right";
  runCtx.fillStyle = PALETTE["fg-faint"];
  runCtx.font = "400 10px " + PALETTE.sans;
  runCtx.fillText("generation", left - 5, h - axis + 3);
}

function lastSample(name) {
  const line = series.get(name) || [];
  return line.length ? line[line.length - 1] : null;
}

function sampleAt(name, tick) {
  const line = series.get(name) || [];
  if (!line.length) return null;
  let best = null, bestD = Infinity;
  for (const row of line) {
    const d = Math.abs(row[0] - tick);
    if (d < bestD) { best = row; bestD = d; }
  }
  return best;
}

/* ---- reading the strip ----------------------------------------------------
   Hovering a mark says what it was in a line; clicking pins the same card so it can
   be read at leisure. The card carries the name, where and when, and the two
   populations in the colours they are drawn in — never a paragraph, because the
   pointer is already somewhere else by the time you have read one. The full
   explanation is on the title, for anyone who wants it. */

function markAt(px, py) {
  let best = null, bestDx = 6;
  for (const hit of hits) {
    if (py < hit.top - 2 || py > hit.bottom + 2) continue;
    const dx = Math.abs(px - hit.x);
    if (dx <= bestDx) { best = hit.mark; bestDx = dx; }
  }
  return best;
}

function markHead(mark) {
  return `<b class="tip-title">${mark.title}</b>` +
    `<span class="tip-where">${mark.island} · generation <b class="k-tick">${figure(mark.tick)}</b></span>` +
    `<span class="tip-quick">${mark.quick}</span>`;
}

/** Hovering is a glance: what it was, where, when. Nothing to read. */
function quickCard(mark) {
  return markHead(mark) + `<em>click for the full account</em>`;
}

/** Clicking is the account: the populations at that moment, and what it did. */
function fullCard(mark) {
  const counts = mark.prey === null ? "" :
    `<span class="tip-counts">` +
    `<span><b class="k-prey">${figure(mark.prey)}</b>prey</span>` +
    `<span><b class="k-pred">${figure(mark.pred)}</b>predators</span></span>`;
  return markHead(mark) + counts + `<span class="tip-detail">${mark.detail}</span>`;
}

runCanvas.addEventListener("mousemove", e => {
  const box = runCanvas.getBoundingClientRect();
  const px = e.clientX - box.left, py = e.clientY - box.top;
  if (!plot) return;

  // Hold the domain still for as long as the pointer is on the plot, so a mark stays
  // where the eye put it instead of sliding left four times a second.
  if (!frozen) frozen = { first: plot.first, last: plot.last };

  const inside = px >= plot.left && px <= plot.left + plot.plotW && py <= plot.height - plot.axis;
  cursor = inside ? { x: px, tick: plot.tickAt(px) } : null;

  const mark = inside ? markAt(px, py) : null;
  runCanvas.style.cursor = mark ? "pointer" : inside ? "crosshair" : "default";
  if (!tipIsPinned()) {
    if (mark !== hovered) {
      hovered = mark;
      if (mark) openTipAt(e.clientX, e.clientY, quickCard(mark));
      else closeTip();
    }
  } else {
    hovered = mark || hovered;
  }
  drawRun();
});

runCanvas.addEventListener("mouseleave", () => {
  frozen = null;
  cursor = null;
  runCanvas.style.cursor = "default";
  if (!tipIsPinned()) { hovered = null; closeTip(); }
  drawRun();
});

runCanvas.addEventListener("click", e => {
  const box = runCanvas.getBoundingClientRect();
  const mark = markAt(e.clientX - box.left, e.clientY - box.top);
  if (!mark) { closeTip(); hovered = null; drawRun(); return; }
  hovered = mark;
  openTipAt(e.clientX, e.clientY, fullCard(mark), true);
  drawRun();
});
