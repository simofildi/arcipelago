/* The canvases draw in the same palette as the stylesheet, read from the custom
   properties on :root so there is only ever one place where a colour is decided.
   Re-read when the system flips between light and dark, because the tokens change
   underneath and a canvas has no way of noticing on its own. */

export const PALETTE = {};

export function readPalette() {
  const style = getComputedStyle(document.documentElement);
  for (const token of ["fg", "fg-muted", "fg-faint", "recess", "prey", "pred", "prey-line", "pred-line", "cross", "cross-lit", "sans", "figures"]) {
    PALETTE[token] = style.getPropertyValue("--" + token).trim();
  }
}
