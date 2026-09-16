/* TWO PALETTES, AND WHICH ONE THIS TAB IS SHOWING.
 *
 * A preview tool, not a setting: it lives in session storage, so it is per tab
 * and gone when the tab is. No server knows about it and nothing is remembered
 * about anybody.
 *
 * Not to be confused with lib/palette.ts, which is the site's colours as hex
 * for share cards. This is only the switch for looking at a quieter version of
 * them. See globals.css under [data-palette="calm"] for what changes, and
 * components/PaletteLab.tsx for the switch itself. Delete the three together
 * once the choice is made. */

export type Palette = "current" | "calm";

/** Stored under this key: a palette name, or "off" after a Hide. */
export const PALETTE_KEY = "sw-palette";

/* Session storage throws in a locked-down browser, and a preview tool is never
 * worth a blank page. */
export function readPalette(): string | null {
  try {
    return window.sessionStorage.getItem(PALETTE_KEY);
  } catch {
    return null;
  }
}

export function writePalette(v: string) {
  try {
    window.sessionStorage.setItem(PALETTE_KEY, v);
  } catch {
    // The switch still works; it just forgets on the next page.
  }
}

/** Paint the page in a palette. The calm one is a data attribute on <html>. */
export function applyPalette(p: Palette) {
  const root = document.documentElement;
  if (p === "calm") root.dataset.palette = "calm";
  else delete root.dataset.palette;
}

/** What a stored value means; anything unrecognised means the current one. */
export const paletteOf = (stored: string | null): Palette => (stored === "calm" ? "calm" : "current");
