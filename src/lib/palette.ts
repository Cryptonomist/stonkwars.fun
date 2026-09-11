/* The palette as hex, for the places CSS variables cannot reach: share cards
 * and brand images. Must match @theme in globals.css. No yellow. */

export const PALETTE = {
  void: "#07070b",
  panel: "#0e0e16",
  line: "#25253a",
  ink: "#f3f3f8",
  dim: "#9090a8",
  p1: "#2fe0ff",
  p2: "#ff3ea5",
  up: "#35f28b",
  down: "#ff4d5e",
  cooked: "#ff7a1a",
} as const;

/** The mark as SVG markup: two rising charts, cyan and pink, crossed. */
export function markSvg(stroke = 3.2): string {
  const { p1, p2 } = PALETTE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke-linecap="square" stroke-linejoin="miter">
<polyline points="4,27 10,19 14,22 25,7" stroke="${p1}" stroke-width="${stroke}"/>
<polyline points="21,6 26,6 26,11" stroke="${p1}" stroke-width="${stroke}"/>
<polyline points="28,27 22,19 18,22 7,7" stroke="${p2}" stroke-width="${stroke}"/>
<polyline points="11,6 6,6 6,11" stroke="${p2}" stroke-width="${stroke}"/>
</svg>`;
}
