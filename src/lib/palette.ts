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
  /** The mark's ground: a cabinet's violet, so the circle keeps an edge on a
   *  black timeline, where a near-black logo would have none. */
  cabinet: "#160a26",
} as const;

/* THE MARK: TWO CANDLESTICKS CROSSED LIKE SWORDS.
 *
 * One cyan, one pink, with the spark of the hit between them. The fighters'
 * colours are deliberately not the market's green and red: those two already
 * mean up and down everywhere else, and a green fighter who is losing would
 * read as a bug.
 *
 * Drawn in a 400 box so one set of numbers serves a 32-pixel nav mark and a
 * 400-pixel profile picture. */

export const MARK_BOX = 400;

type Candle = { cx: number; cy: number; body: number; wick: number; width: number; rotate: number };

const CANDLES: Candle[] = [
  { cx: 200, cy: 200, body: 214, wick: 54, width: 106, rotate: 34 },
  { cx: 200, cy: 200, body: 214, wick: 54, width: 106, rotate: -34 },
];

/** A star's points, for the spark where the candles cross. */
export function sparkPoints(cx: number, cy: number, outer: number, inner: number, spikes = 8): string {
  return Array.from({ length: spikes * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    const r = i % 2 ? inner : outer;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");
}

function candleParts(c: Candle, rim: number) {
  const top = c.cy - c.body / 2;
  return {
    wick: { x: c.cx - 11, y: top - c.wick, w: 22, h: c.body + c.wick * 2, r: 3 },
    wickFill: { x: c.cx - 8, y: top - c.wick + 3, w: 16, h: c.body + c.wick * 2 - 6, r: 2 },
    rim: { x: c.cx - c.width / 2 - rim, y: top - rim, w: c.width + rim * 2, h: c.body + rim * 2, r: 6 },
    body: { x: c.cx - c.width / 2, y: top, w: c.width, h: c.body, r: 3 },
    rotate: c.rotate,
  };
}

export type MarkOptions = {
  /** "cabinet" draws the violet disc and its scanlines; "none" leaves the mark
   *  transparent, for a page that already has a background. */
  ground?: "cabinet" | "none";
  p1?: string;
  p2?: string;
  outline?: string;
};

/** The mark as SVG markup, for images and data URIs. */
export function markSvg(opts: MarkOptions = {}): string {
  const { p1 = PALETTE.p1, p2 = PALETTE.p2, ground = "none" } = opts;
  const outline = opts.outline ?? (ground === "cabinet" ? "#120820" : PALETTE.void);
  const rim = 7;
  const grad = (id: string, light: string, dark: string) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.45" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
  const dim = (hex: string) => `${hex}`;
  const scan = Array.from({ length: 50 }, (_, i) => `<rect y="${i * 8}" width="400" height="2" fill="#ffffff" opacity="0.05"/>`).join("");
  const disc =
    ground === "cabinet"
      ? `<rect width="400" height="400" fill="${PALETTE.cabinet}"/>
<rect width="400" height="400" fill="url(#glowA)"/><rect width="400" height="400" fill="url(#glowB)"/>${scan}`
      : "";
  const glows =
    ground === "cabinet"
      ? `<radialGradient id="glowA" cx="0.32" cy="0.42" r="0.5"><stop offset="0" stop-color="${p1}" stop-opacity="0.3"/><stop offset="1" stop-color="${p1}" stop-opacity="0"/></radialGradient>
<radialGradient id="glowB" cx="0.68" cy="0.58" r="0.5"><stop offset="0" stop-color="${p2}" stop-opacity="0.3"/><stop offset="1" stop-color="${p2}" stop-opacity="0"/></radialGradient>`
      : "";
  const candle = (c: Candle, fillId: string) => {
    const p = candleParts(c, rim);
    return `<g transform="rotate(${p.rotate} ${c.cx} ${c.cy})">
<rect x="${p.wick.x}" y="${p.wick.y}" width="${p.wick.w}" height="${p.wick.h}" rx="${p.wick.r}" fill="${outline}"/>
<rect x="${p.wickFill.x}" y="${p.wickFill.y}" width="${p.wickFill.w}" height="${p.wickFill.h}" rx="${p.wickFill.r}" fill="url(#${fillId})"/>
<rect x="${p.rim.x}" y="${p.rim.y}" width="${p.rim.w}" height="${p.rim.h}" rx="${p.rim.r}" fill="${outline}"/>
<rect x="${p.body.x}" y="${p.body.y}" width="${p.body.w}" height="${p.body.h}" rx="${p.body.r}" fill="url(#${fillId})"/>
</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<defs>${grad("markP1", dim(p1), shade(p1))}${grad("markP2", dim(p2), shade(p2))}${glows}</defs>
${disc}
${candle(CANDLES[0], "markP2")}
${candle(CANDLES[1], "markP1")}
<polygon points="${sparkPoints(200, 200, 54, 16)}" fill="${outline}"/>
<polygon points="${sparkPoints(200, 200, 46, 14)}" fill="#ffffff"/>
</svg>`;
}

/** A darker shade of a hex colour, for the bottom of a candle's body. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v * 0.45);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0")).join("")}`;
}
