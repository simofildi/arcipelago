/* The starting gate.

   The islands seed their worlds, publish them and then stand still, so the archipelago
   is on screen and legible before anything evolves. This card is the one control that
   decides what happens next, and it asks its question before acting rather than after:
   how long should this run be. Nothing moves until it is answered.

   Whether it is shown comes from the run's own state on every poll, never from a local
   flag, so two people watching the same archipelago always see the same thing — and a
   reload mid-run does not offer to start a run that is already going. */

import { post } from "./state.js";
import { RUN_LENGTHS } from "./params.js";
import { infoTag } from "./tooltip.js";

const card = document.getElementById("start");
let chosen = RUN_LENGTHS.find(l => l.preselected) || RUN_LENGTHS[0];
let sent = false;

function paintChoice() {
  for (const btn of card.querySelectorAll("[data-length]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.length === chosen.id));
  }
}

export function buildStart() {
  card.innerHTML =
    `<h2 class="start-name">Ready when you are</h2>` +
    `<p class="start-note">The three islands are seeded and standing still. Nothing evolves ` +
    `until you start it.</p>` +
    `<div class="start-row">` +
      `<span class="start-label">How long${
        infoTag("Every island stops at this generation, and the stack then writes its output " +
                "files and shuts itself down on its own. You can change every parameter while " +
                "the run is going, so a short run you repeat often is usually more informative " +
                "than one long one.", "How long the run should be")}</span>` +
      `<span class="lengths" id="start-lengths" role="radiogroup" ` +
        `aria-label="How long the run should be"></span>` +
    `</div>` +
    `<button class="go" id="start-go" type="button">Start the run</button>`;

  const group = card.querySelector("#start-lengths");
  for (const option of RUN_LENGTHS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.dataset.length = option.id;
    btn.textContent = option.label;
    btn.setAttribute("data-tip-title", option.generations
      ? `${option.generations.toLocaleString("en-US")} generations` : "No limit");
    btn.setAttribute("data-tip", option.help);
    btn.addEventListener("click", () => { chosen = option; paintChoice(); });
    group.appendChild(btn);
  }
  paintChoice();

  const go = card.querySelector("#start-go");
  go.addEventListener("click", async () => {
    if (sent) return;
    /* Three things have to happen in this order, and getting them wrong is what made
       an earlier version look broken. The button says it heard you, because the
       islands take a moment to notice and a control that does not move reads as dead.
       The send is awaited, because a failure that latches `sent` would swallow every
       later click in silence. And only then is the card dismissed — `showStart` below
       refuses to bring it back, since the next poll still reports the old state for a
       moment and a card that flickers back reads as a click that did not take. */
    sent = true;
    go.disabled = true;
    go.textContent = "Starting";
    if (await post("/start", { generations: chosen.generations })) {
      showStart(false);
      return;
    }
    sent = false;
    go.disabled = false;
    go.textContent = "Start the run";
    card.querySelector(".start-note").textContent =
      "That did not reach the archipelago. Check the containers are still up, then try again.";
  });
}

export function showStart(show) {
  // Never reopen after a start has been accepted: `/state` reports the run as not yet
  // begun for a poll or two afterwards, and that is not a reason to ask again.
  card.hidden = !(show && !sent);
}
