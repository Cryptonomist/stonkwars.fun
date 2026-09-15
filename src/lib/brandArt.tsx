/* The brand's own images: the X profile picture and header, drawn in code so
 * the type and colours can never drift from the site.
 *
 * The header is the arcade title screen: two fighters, two health bars, a
 * round clock and a coin slot that takes shares. The profile picture is the
 * mark from lib/palette.ts on its cabinet ground.
 *
 * Shared with lib/brandLab.tsx, which renders the alternatives that were not
 * chosen. */

import { ImageResponse } from "next/og";
import type { CSSProperties, ReactElement } from "react";
import sharp from "sharp";

import { loadGoogleFont } from "@/lib/ogFont";
import { markSvg } from "@/lib/palette";

export const W = 1500;
export const H = 500;
export const P = 400;

export type Weight = 400 | 700 | 900;
export type Font = { name: string; data: ArrayBuffer; weight: Weight; style: "normal" };

export async function fonts(specs: [name: string, family: string, weight: Weight, text: string][]): Promise<Font[]> {
  const out: Font[] = [];
  for (const [name, family, weight, text] of specs) {
    const data = await loadGoogleFont(family, weight, `${text}${text.toUpperCase()}${text.toLowerCase()} `);
    if (data) out.push({ name, data, weight, style: "normal" });
  }
  return out;
}

export const svg = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`;

/** A data-URI SVG, rasterized first: the card renderer drops some gradient
 * paths from embedded SVGs that other renderers draw fine. */
export async function raster(dataUri: string): Promise<string> {
  const markup = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  const png = await sharp(markup).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

export const render = (node: ReactElement, width: number, height: number, list: Font[]) =>
  new ImageResponse(node, { width, height, fonts: list.length ? list : undefined });

export const fill: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex" };

/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
export const Pic = ({ src, x, y, w, h, style }: { src: string; x: number; y: number; w: number; h: number; style?: CSSProperties }) => (
  <img src={src} width={w} height={h} style={{ position: "absolute", left: x, top: y, ...style }} />
);

export const AR = { sky: "#07021a", night: "#1d0638", dusk: "#4a0d58", cyan: "#2fe0ff", pink: "#ff3ea5", ember: "#ff7a1a" };

/** The night, the sun and the grid floor, as one image. A sunR of 0 leaves the
 *  sun out, for a scene that puts something else on the horizon. */
export function synthwave(w: number, h: number, horizon: number, sunR: number, seed: number) {
  const r = rng(seed);
  const stars = Array.from({ length: Math.round(w / 18) }, () => {
    const x = r() * w;
    const y = r() * (horizon - 30);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.7 + r() * 1.3).toFixed(2)}" fill="#fff" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
  }).join("");
  const cx = w / 2;
  const stripes = `<g clip-path="url(#disc)">${Array.from({ length: 6 }, (_, i) => {
    const y = horizon - sunR * 0.56 + i * (sunR * 0.1);
    return `<rect x="${cx - sunR - 4}" y="${y.toFixed(1)}" width="${sunR * 2 + 8}" height="${(3 + i * 1.8).toFixed(1)}" fill="#3a0b4e"/>`;
  }).join("")}</g>`;
  const floorH = h - horizon;
  const verticals = Array.from({ length: 41 }, (_, i) => {
    const k = i - 20;
    return `<line x1="${cx + k * 16}" y1="${horizon}" x2="${cx + k * 150}" y2="${h}" stroke="${AR.pink}" stroke-width="2" stroke-opacity="0.55"/>`;
  }).join("");
  const horizontals = Array.from({ length: 8 }, (_, i) => {
    const y = horizon + floorH * Math.pow((i + 1) / 8, 1.9);
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="${AR.pink}" stroke-width="2" stroke-opacity="${(0.25 + 0.4 * ((i + 1) / 8)).toFixed(2)}"/>`;
  }).join("");
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AR.sky}"/><stop offset="0.6" stop-color="${AR.night}"/><stop offset="1" stop-color="${AR.dusk}"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5fb8"/><stop offset="0.55" stop-color="${AR.pink}"/><stop offset="1" stop-color="${AR.ember}"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0433"/><stop offset="1" stop-color="#050010"/></linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AR.pink}" stop-opacity="0"/><stop offset="1" stop-color="${AR.pink}" stop-opacity="0.35"/></linearGradient>
<clipPath id="disc"><circle cx="${cx}" cy="${horizon}" r="${sunR}"/></clipPath>
</defs>
<rect width="${w}" height="${horizon}" fill="url(#sky)"/>${stars}
${sunR > 0 ? `<circle cx="${cx}" cy="${horizon}" r="${sunR}" fill="url(#sun)"/>${stripes}` : ""}
<rect y="${horizon - 70}" width="${w}" height="70" fill="url(#haze)"/>
<rect y="${horizon}" width="${w}" height="${floorH}" fill="url(#floor)"/>${verticals}${horizontals}
<rect y="${horizon - 2}" width="${w}" height="4" fill="${AR.pink}"/>
</svg>`);
}

/** Chrome letters with a cyan rim and a magenta extrusion, in three layers. A
 * real box, not a fragment: the renderer sizes a fragment to nothing. */
export function Chrome({ text, size, top, face, skew = -10, spacing = 2 }: { text: string; size: number; top: number; face: string; skew?: number; spacing?: number }) {
  const base: CSSProperties = {
    position: "absolute",
    left: 0,
    top,
    width: "100%",
    display: "flex",
    justifyContent: "center",
    fontFamily: face,
    fontSize: size,
    lineHeight: 1,
    letterSpacing: spacing,
    transform: `skewX(${skew}deg)`,
  };
  const depth = Array.from({ length: 12 }, (_, i) => `0px ${i + 1}px 0 ${i < 6 ? "#c8177f" : "#6a0e58"}`).join(", ");
  return (
    <div style={fill}>
      <div style={{ ...base, color: "#7b1470", textShadow: `${depth}, 0 20px 26px rgba(0,0,0,0.6)` }}>{text}</div>
      <div style={{ ...base, color: AR.cyan, WebkitTextStroke: `${Math.round(size / 12)}px ${AR.cyan}` }}>{text}</div>
      <div
        style={{
          ...base,
          color: "transparent",
          backgroundImage: "linear-gradient(180deg, #ffffff 0%, #eef2fa 30%, #98a4be 48%, #2b3450 50%, #c9d2e4 54%, #ffffff 74%, #a7b3ca 100%)",
          backgroundClip: "text",
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function Health({ label, fillPct, color, align }: { label: string; fillPct: number; color: string; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "flex-end", gap: 8 }}>
      <span style={{ fontSize: 17, color, textShadow: `0 0 10px ${color}` }}>{label}</span>
      <div style={{ display: "flex", justifyContent: align === "left" ? "flex-start" : "flex-end", width: 520, height: 30, border: "4px solid #ffffff", background: "#2a0620" }}>
        <div style={{ display: "flex", width: `${fillPct}%`, height: "100%", backgroundImage: `linear-gradient(180deg, #ffffff 0%, ${color} 35%, ${color} 70%, rgba(0,0,0,0.35) 100%)` }} />
      </div>
    </div>
  );
}

/** The X header: 1500x500, with everything that must be read kept clear of the
 * bottom-left corner the profile picture covers. */
export async function arcadeBanner() {
  const list = await fonts([
    ["Russo", "Russo One", 400, "STONK WARS"],
    ["Pixel", "Press Start 2P", 400, "1P TSLA NVDA 2P 99 INSERT SHARES TO FIGHT STONKWARS.FUN"],
  ]);
  return render(
    <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Pixel", color: "#fff" }}>
      <Pic src={synthwave(W, H, 346, 176, 7)} x={0} y={0} w={W} h={H} />
      <div style={{ position: "absolute", left: 50, top: 24, width: 1400, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <Health label="1P  TSLA" fillPct={86} color={AR.cyan} align="left" />
        <div style={{ display: "flex", fontSize: 34, border: "4px solid #fff", padding: "10px 12px 8px", marginBottom: -6, background: "#07021a" }}>99</div>
        <Health label="NVDA  2P" fillPct={58} color={AR.pink} align="right" />
      </div>
      <Chrome text="STONK WARS" size={148} top={128} face="Russo" />
      <div style={{ position: "absolute", left: 0, top: 300, width: "100%", display: "flex", justifyContent: "center", fontSize: 22, letterSpacing: 2, color: AR.cyan, textShadow: `0 0 12px ${AR.cyan}` }}>
        INSERT SHARES TO FIGHT
      </div>
      <div style={{ position: "absolute", right: 46, bottom: 30, display: "flex", fontSize: 15, color: "#ffffff", opacity: 0.85 }}>STONKWARS.FUN</div>
    </div>,
    W,
    H,
    list,
  );
}

/* THE BATTLE ROYALE: THE X HEADER SINCE 15 SEP.
 *
 * The same arcade title screen, the same night, grid floor, chrome title,
 * health bars and colours, but the sun on the horizon is gone and in its place
 * the whole roster is fighting. Every duel is two tickers, cyan against pink,
 * each swinging the candlestick sword from the mark, with the spark of the hit
 * where the blades cross. The duels recede to the horizon: big and bright on
 * the flanks and the floor in front, small and faint at the back, so the title
 * still reads first.
 *
 * The tickers are real roster stocks and nothing else is data: no prices, no
 * moves, no scores. Readable things stay clear of the bottom-left corner that
 * the profile picture covers on desktop. */

const BATTLERS = [
  "NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AMD", "COIN", "HOOD", "MSTR", "PLTR",
  "SPY", "QQQ", "NFLX", "GME", "CRCL", "MU", "INTC", "AVGO", "ORCL", "SNDK", "SPCX", "SKHY",
];

type Duel = { x: number; y: number; s: number; o: number; a: string; b: string; labels: boolean };

/* Where the duels stand, by row. Rows are staggered so a nearer duel's blades
 * rise between the farther duels' plates rather than through them; the front
 * row keeps the bottom-left (profile picture) and bottom-right (the address)
 * corners clear. */
const BATTLE_ROWS: { y: number; s: number; o: number; xs: number[]; labels: boolean }[] = [
  { y: 334, s: 0.3, o: 0.4, xs: [40, 135, 230, 325, 420, 515, 610, 705, 800, 895, 990, 1085, 1180, 1275, 1370, 1465], labels: false },
  { y: 398, s: 0.52, o: 0.74, xs: [205, 520, 850, 1180, 1400], labels: true },
  { y: 472, s: 0.86, o: 0.96, xs: [360, 690, 1020], labels: true },
];
/** The flanks: the two headliners either side of the title. */
const HEADLINERS: [string, string][] = [
  ["AAPL", "MSFT"],
  ["COIN", "HOOD"],
];

function battleDuels(seed: number): Duel[] {
  const r = rng(seed);
  // Every pair different: deal the roster out in a shuffled order, two at a time.
  const deck = BATTLERS.filter((t) => !HEADLINERS.flat().includes(t));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let next = 0;
  const deal = (): [string, string] => {
    const a = deck[next++ % deck.length];
    const b = deck[next++ % deck.length];
    return [a, b];
  };
  const out: Duel[] = [];
  for (const row of BATTLE_ROWS) {
    for (const x of row.xs) {
      const [a, b] = row.labels ? deal() : ["", ""];
      out.push({ x: x + (r() - 0.5) * 20 * row.s, y: row.y + (r() - 0.5) * 8 * row.s, s: row.s * (0.94 + r() * 0.12), o: row.o, a, b, labels: row.labels });
    }
  }
  out.push({ x: 134, y: 266, s: 0.9, o: 1, a: HEADLINERS[0][0], b: HEADLINERS[0][1], labels: true });
  out.push({ x: 1366, y: 266, s: 0.9, o: 1, a: HEADLINERS[1][0], b: HEADLINERS[1][1], labels: true });
  return out;
}

/** One candlestick sword: wick from hilt to tip, and a body along the blade. */
function sword(x1: number, y1: number, x2: number, y2: number, s: number, color: string, opacity: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const bodyW = 17 * s;
  const bodyL = len * 0.5;
  const wick = 3.6 * s;
  const edge = 2.2 * s;
  return `<g transform="translate(${x1.toFixed(1)} ${y1.toFixed(1)}) rotate(${deg.toFixed(1)})" opacity="${opacity}">
<rect x="0" y="${(-wick / 2 - edge).toFixed(2)}" width="${len.toFixed(1)}" height="${(wick + edge * 2).toFixed(2)}" fill="${AR.sky}"/>
<rect x="0" y="${(-wick / 2).toFixed(2)}" width="${len.toFixed(1)}" height="${wick.toFixed(2)}" fill="${color}"/>
<rect x="${(len * 0.34 - edge).toFixed(1)}" y="${(-bodyW / 2 - edge).toFixed(2)}" width="${(bodyL + edge * 2).toFixed(1)}" height="${(bodyW + edge * 2).toFixed(2)}" fill="${AR.sky}"/>
<rect x="${(len * 0.34).toFixed(1)}" y="${(-bodyW / 2).toFixed(2)}" width="${bodyL.toFixed(1)}" height="${bodyW.toFixed(2)}" fill="${color}"/>
<rect x="${(len * 0.34 + bodyW * 0.18).toFixed(1)}" y="${(-bodyW / 2 + bodyW * 0.14).toFixed(2)}" width="${(bodyL * 0.6).toFixed(1)}" height="${(bodyW * 0.16).toFixed(2)}" fill="#ffffff" opacity="0.45"/>
</g>`;
}

/** The swords, the sparks and the glow of every duel, as one image. */
function battlefield(duels: Duel[], seed: number) {
  const r = rng(seed);
  const star = (cx: number, cy: number, outer: number, inner: number, spikes = 8) =>
    Array.from({ length: spikes * 2 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / spikes + 0.2;
      const rad = i % 2 ? inner : outer;
      return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
    }).join(" ");
  const parts: string[] = [];
  // Behind everything: the flare where the sun used to be, so the horizon still glows.
  parts.push(`<ellipse cx="${W / 2}" cy="346" rx="560" ry="120" fill="url(#flare)"/>`);
  for (const d of duels) {
    const { x, y, s, o } = d;
    // Each fighter's hilt is at the inner top corner of its plate; the blades
    // cross in an X over the gap between the two plates, where the spark is.
    const hiltX = 30 * s;
    const hiltY = y - 14 * s;
    const tipX = 46 * s;
    const tipY = y - 110 * s;
    const t = hiltX / (hiltX + tipX);
    const clashY = hiltY + (tipY - hiltY) * t;
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${clashY.toFixed(1)}" r="${(46 * s).toFixed(1)}" fill="url(#hit)" opacity="${(o * 0.9).toFixed(2)}"/>`);
    parts.push(sword(x - hiltX, hiltY, x + tipX, tipY, s, AR.cyan, o));
    parts.push(sword(x + hiltX, hiltY, x - tipX, tipY, s, AR.pink, o));
    parts.push(`<polygon points="${star(x, clashY, 22 * s, 6 * s)}" fill="#ffffff" opacity="${o}"/>`);
    // Sparks thrown off the hit.
    for (let k = 0; k < 5; k++) {
      const a = r() * Math.PI * 2;
      const dist = (22 + r() * 26) * s;
      const color = [AR.cyan, AR.pink, AR.ember, "#ffffff"][Math.floor(r() * 4)];
      parts.push(
        `<circle cx="${(x + Math.cos(a) * dist).toFixed(1)}" cy="${(clashY + Math.sin(a) * dist).toFixed(1)}" r="${((1 + r() * 1.6) * s + 0.4).toFixed(2)}" fill="${color}" opacity="${(o * (0.6 + r() * 0.4)).toFixed(2)}"/>`,
      );
    }
  }
  // Embers drifting over the whole field.
  for (let k = 0; k < 70; k++) {
    const color = [AR.pink, AR.ember, AR.cyan][Math.floor(r() * 3)];
    parts.push(
      `<circle cx="${(r() * W).toFixed(1)}" cy="${(150 + r() * 350).toFixed(1)}" r="${(0.8 + r() * 1.8).toFixed(2)}" fill="${color}" opacity="${(0.25 + r() * 0.5).toFixed(2)}"/>`,
    );
  }
  // A shadow behind the title and tagline, so they still read first.
  parts.push(`<ellipse cx="${W / 2}" cy="226" rx="560" ry="118" fill="url(#hush)"/>`);
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="flare"><stop offset="0" stop-color="${AR.pink}" stop-opacity="0.55"/><stop offset="0.45" stop-color="${AR.ember}" stop-opacity="0.18"/><stop offset="1" stop-color="${AR.pink}" stop-opacity="0"/></radialGradient>
<radialGradient id="hit"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="0.35" stop-color="${AR.ember}" stop-opacity="0.55"/><stop offset="1" stop-color="${AR.pink}" stop-opacity="0"/></radialGradient>
<radialGradient id="hush"><stop offset="0" stop-color="${AR.sky}" stop-opacity="0.72"/><stop offset="0.7" stop-color="${AR.sky}" stop-opacity="0.35"/><stop offset="1" stop-color="${AR.sky}" stop-opacity="0"/></radialGradient>
</defs>
${parts.join("\n")}
</svg>`);
}

/** The X header: the arcade title screen over a battle royale of tickers. */
export async function battleBanner() {
  const duels = battleDuels(15);
  const list = await fonts([
    ["Russo", "Russo One", 400, `STONK WARS ${BATTLERS.join(" ")}`],
    ["Pixel", "Press Start 2P", 400, "1P TSLA NVDA 2P 99 INSERT SHARES TO FIGHT STONKWARS.FUN"],
  ]);
  const field = await raster(battlefield(duels, 21));
  /* A fighter: its ticker on a slanted plate in its corner's colour, the way
   * the site draws a corner. The plate keeps the ticker readable over the grid. */
  const label = (d: Duel, side: "a" | "b") => {
    const size = Math.round(28 * d.s);
    const color = side === "a" ? AR.cyan : AR.pink;
    const box = 112 * d.s;
    const cx = side === "a" ? d.x - 66 * d.s : d.x + 66 * d.s;
    const h = Math.round(size * 1.45);
    return (
      <div
        key={`${d.x}-${d.y}-${side}`}
        style={{
          position: "absolute",
          left: Math.round(cx - box / 2),
          top: Math.round(d.y - h / 2),
          width: Math.round(box),
          height: h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Russo",
          fontSize: size,
          lineHeight: 1,
          color,
          opacity: d.o,
          background: "rgba(7,2,26,0.82)",
          border: `${Math.max(1, Math.round(2.6 * d.s))}px solid ${color}`,
          boxShadow: `0 0 ${Math.round(14 * d.s)}px ${color}`,
          transform: "skewX(-12deg)",
          textShadow: `0 0 ${Math.round(10 * d.s)}px ${color}`,
        }}
      >
        {side === "a" ? d.a : d.b}
      </div>
    );
  };
  return render(
    <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Pixel", color: "#fff" }}>
      <Pic src={synthwave(W, H, 346, 0, 7)} x={0} y={0} w={W} h={H} />
      <Pic src={field} x={0} y={0} w={W} h={H} />
      {duels.filter((d) => d.labels).flatMap((d) => [label(d, "a"), label(d, "b")])}
      <div style={{ position: "absolute", left: 50, top: 24, width: 1400, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <Health label="1P  TSLA" fillPct={86} color={AR.cyan} align="left" />
        <div style={{ display: "flex", fontSize: 34, border: "4px solid #fff", padding: "10px 12px 8px", marginBottom: -6, background: "#07021a" }}>99</div>
        <Health label="NVDA  2P" fillPct={58} color={AR.pink} align="right" />
      </div>
      <Chrome text="STONK WARS" size={148} top={122} face="Russo" />
      <div style={{ position: "absolute", left: 0, top: 292, width: "100%", display: "flex", justifyContent: "center", fontSize: 22, letterSpacing: 2, color: AR.cyan, textShadow: `0 0 12px ${AR.cyan}, 0 2px 0 ${AR.sky}` }}>
        INSERT SHARES TO FIGHT
      </div>
      <div style={{ position: "absolute", right: 46, bottom: 22, display: "flex", fontSize: 15, color: "#ffffff", background: "rgba(7,2,26,0.7)", padding: "6px 8px" }}>STONKWARS.FUN</div>
    </div>,
    W,
    H,
    list,
  );
}

/** The X profile picture: the mark on its cabinet ground, 400x400. */
export async function markPfp() {
  const art = await raster(svg(markSvg({ ground: "cabinet" })));
  return render(
    <div style={{ width: P, height: P, display: "flex", position: "relative" }}>
      <Pic src={art} x={0} y={0} w={P} h={P} />
    </div>,
    P,
    P,
    [],
  );
}
