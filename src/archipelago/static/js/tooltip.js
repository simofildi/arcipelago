/* The info affordance.

   One tooltip element, moved and filled on demand and positioned in viewport
   coordinates, so it is never clipped by the scrolling panel its anchor lives in.
   Hover and keyboard focus open it; on a touch screen a tap does, since there is no
   hover to speak of there. Acting on the control closes it again. */

let tip = null;
let tipFor = null;
let pinnedTip = false;

/* A control the person has just acted on. Its description answers "what does this do",
   and once the thing has been done the answer is spent: the tooltip is in the way, and
   on a toggle it is worse than in the way, since the button has already flipped to the
   opposite state while the text still describes the one before. Held until the pointer
   moves off, because the pointer does not leave the button by being clicked and the
   next twitch over it would otherwise fire `pointerover` again and reopen what was
   just dismissed, which reads as a flicker rather than as an answer. */
let silenced = null;

export function openTip(anchor) {
  const text = anchor.dataset.tip;
  if (!text) return;
  const title = anchor.dataset.tipTitle;
  const ref = anchor.dataset.tipRef;
  tip.innerHTML = (title ? `<b>${title}</b>` : "") + text + (ref ? `<em>${ref}</em>` : "");
  tip.classList.add("is-open");
  anchor.setAttribute("aria-expanded", "true");
  tipFor = anchor;

  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left = a.left + a.width / 2 - t.width / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - t.width - 10));
  let top = a.top - t.height - 9;
  if (top < 10) top = a.bottom + 9;
  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
}

/* The same tooltip, placed at a point rather than against an element, for marks
   drawn inside a canvas that have no DOM node to anchor to. Pinned tooltips survive
   the pointer leaving and take clicks, so a detailed one can be read at leisure. */
export function openTipAt(x, y, html, pinned = false) {
  tip.innerHTML = html;
  tip.classList.add("is-open");
  tip.classList.toggle("is-pinned", pinned);
  tipFor = null;
  pinnedTip = pinned;
  const t = tip.getBoundingClientRect();
  let left = Math.max(10, Math.min(x - t.width / 2, window.innerWidth - t.width - 10));
  let top = y - t.height - 12;
  if (top < 10) top = y + 16;
  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
}

export function tipIsPinned() { return pinnedTip; }

export function closeTip() {
  pinnedTip = false;
  tip.classList.remove("is-open", "is-pinned");
  if (tipFor) tipFor.setAttribute("aria-expanded", "false");
  tipFor = null;
}

export function infoTag(text, title, ref) {
  return `<button class="info" type="button" aria-expanded="false" aria-label="What is ${title}?"` +
    ` data-tip-title="${title}" data-tip="${text}"${ref ? ` data-tip-ref="${ref}"` : ""}>i</button>`;
}

export function initTooltips() {
  tip = document.getElementById("tip");
  document.addEventListener("pointerover", e => {
    if (pinnedTip) return;
    const anchor = e.target.closest("[data-tip]");
    if (silenced && anchor !== silenced) silenced = null;   // the pointer has moved on
    if (anchor && anchor !== tipFor && anchor !== silenced) openTip(anchor);
    else if (!anchor && tipFor) closeTip();
  });
  document.addEventListener("focusin", e => {
    const anchor = e.target.closest("[data-tip]");
    if (silenced && anchor !== silenced) silenced = null;
    if (anchor && anchor !== silenced) openTip(anchor); else closeTip();
  });
  document.addEventListener("click", e => {
    const anchor = e.target.closest(".info");
    if (!anchor) {
      /* Acting on a control dismisses that control's own description. The `i` handled
         below is the exception, because clicking it is how a description is asked for
         in the first place. */
      const acted = e.target.closest("[data-tip]");
      if (acted) { silenced = acted; closeTip(); return; }
      // A click anywhere that is not the pinned tooltip itself dismisses it.
      if (pinnedTip && !e.target.closest("#tip") && !e.target.closest("#run")) closeTip();
      return;
    }
    e.preventDefault();
    tipFor === anchor ? closeTip() : openTip(anchor);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeTip(); });
  window.addEventListener("scroll", closeTip, true);
}
