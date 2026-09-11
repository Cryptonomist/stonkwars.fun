/* Brand lab: alternative directions for the X profile picture and header,
 * drawn with the same engine as the real assets, so whichever is picked
 * exports as it looks. Served at /brand/lab/<direction>/{pfp,banner}.png.
 *
 * Every direction keeps the header's bottom-left corner free of anything that
 * must be read: on a desktop profile the round profile picture covers it. */

import { ImageResponse } from "next/og";
import type { CSSProperties, ReactElement } from "react";
import sharp from "sharp";

import { loadGoogleFont } from "@/lib/ogFont";
import { ROSTER } from "@/lib/stocks";

const W = 1500;
const H = 500;
const P = 400;
const COUNT = ROSTER.length.toLocaleString("en-US");

type Weight = 400 | 700 | 900;
type Font = { name: string; data: ArrayBuffer; weight: Weight; style: "normal" };

async function fonts(specs: [name: string, family: string, weight: Weight, text: string][]): Promise<Font[]> {
  const out: Font[] = [];
  for (const [name, family, weight, text] of specs) {
    const data = await loadGoogleFont(family, weight, `${text}${text.toUpperCase()}${text.toLowerCase()} `);
    if (data) out.push({ name, data, weight, style: "normal" });
  }
  return out;
}

const svg = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`;

/** A data-URI SVG, rasterized first: the card renderer drops some gradient
 * paths from embedded SVGs that other renderers draw fine. */
async function raster(dataUri: string): Promise<string> {
  const markup = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  const png = await sharp(markup).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const render = (node: ReactElement, width: number, height: number, list: Font[]) =>
  new ImageResponse(node, { width, height, fonts: list.length ? list : undefined });

const fill: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex" };

/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
const Pic = ({ src, x, y, w, h, style }: { src: string; x: number; y: number; w: number; h: number; style?: CSSProperties }) => (
  <img src={src} width={w} height={h} style={{ position: "absolute", left: x, top: y, ...style }} />
);

function starPoints(cx: number, cy: number, outer: number, inner: number, spikes = 5, jitter = 0, seed = 1) {
  const r = rng(seed);
  return Array.from({ length: spikes * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    const rad = (i % 2 ? inner : outer) * (1 + (jitter ? (r() - 0.5) * jitter : 0));
    return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
  }).join(" ");
}

const star = (color: string, size: number) =>
  svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="${starPoints(10, 10.6, 9.6, 3.9)}" fill="${color}"/></svg>`);

/* ─────────────────────────────────────────────────────────────────────────
 * A. FIGHT NIGHT: a boxing poster. White paper in a dark feed.
 * ───────────────────────────────────────────────────────────────────────── */

const FN = { paper: "#fbfaf7", ink: "#0c0c0d", red: "#e30b25" };
const CARD: [string, string][] = [
  ["AAPL", "MSFT"],
  ["GME", "AMC"],
  ["COIN", "HOOD"],
  ["MSTR", "SPY"],
];

const fightNight = {
  async banner() {
    const text = `SOLANA PRESENTS STONK WARS YOUR STOCK VS THEIRS · LOSER GETS COOKED ${COUNT} STOCKS LIVE ON SOLANA STONKWARS.FUN MAIN EVENT NVDA TSLA ON THE CARD ${CARD.flat().join(" ")} WINNER TAKES BOTH`;
    const list = await fonts([
      ["Anton", "Anton", 400, text],
      ["Slab", "Alfa Slab One", 400, "VSvs"],
    ]);
    const sep = (c: string) => <Pic src={star(c, 20)} x={0} y={0} w={20} h={20} style={{ position: "relative", margin: "0 16px" }} />;
    return render(
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: FN.paper, fontFamily: "Anton", color: FN.ink }}>
        <div style={{ position: "absolute", left: 14, top: 14, width: W - 28, height: H - 28, border: `6px solid ${FN.ink}`, display: "flex" }} />
        <div style={{ position: "absolute", left: 28, top: 28, width: W - 56, height: H - 56, border: `2px solid ${FN.ink}`, display: "flex" }} />
        <div style={{ position: "absolute", left: 318, top: 62, width: 3, height: 376, background: FN.ink, display: "flex" }} />
        <div style={{ position: "absolute", left: 1179, top: 62, width: 3, height: 376, background: FN.ink, display: "flex" }} />

        <div style={{ position: "absolute", left: 321, top: 0, width: 858, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 28, letterSpacing: 8 }}>
            {sep(FN.ink)}
            <span>SOLANA PRESENTS</span>
            {sep(FN.ink)}
          </div>
          <div style={{ display: "flex", fontSize: 200, lineHeight: 0.95, marginTop: 2 }}>
            <span>STONK</span>
            <span style={{ color: FN.red, marginLeft: 24 }}>WARS</span>
          </div>
          <div style={{ display: "flex", background: FN.red, color: FN.paper, fontSize: 36, letterSpacing: 4, padding: "6px 28px", marginTop: 12 }}>
            YOUR STOCK VS THEIRS · LOSER GETS COOKED
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 26, letterSpacing: 6, marginTop: 16 }}>
            <span>{COUNT} STOCKS</span>
            {sep(FN.red)}
            <span>LIVE ON SOLANA</span>
            {sep(FN.red)}
            <span>STONKWARS.FUN</span>
          </div>
        </div>

        <div style={{ position: "absolute", left: 42, top: 60, width: 262, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 24, letterSpacing: 7, color: FN.red }}>MAIN EVENT</span>
          <span style={{ fontSize: 86, lineHeight: 1.02 }}>NVDA</span>
          <span style={{ fontFamily: "Slab", fontSize: 32, color: FN.red, lineHeight: 1 }}>VS</span>
          <span style={{ fontSize: 86, lineHeight: 1.02 }}>TSLA</span>
        </div>

        <div style={{ position: "absolute", left: 1196, top: 60, width: 262, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 24, letterSpacing: 7, color: FN.red, marginBottom: 4 }}>ON THE CARD</span>
          {CARD.map(([a, b]) => (
            <div key={a} style={{ display: "flex", alignItems: "center", fontSize: 42, lineHeight: 1.18 }}>
              <span>{a}</span>
              <span style={{ fontFamily: "Slab", fontSize: 19, color: FN.red, margin: "0 12px" }}>vs</span>
              <span>{b}</span>
            </div>
          ))}
          <div style={{ display: "flex", marginTop: 26, border: `4px solid ${FN.red}`, color: FN.red, fontSize: 25, letterSpacing: 2, padding: "2px 12px", transform: "rotate(-6deg)", whiteSpace: "nowrap" }}>
            WINNER TAKES BOTH
          </div>
        </div>
      </div>,
      W,
      H,
      list,
    );
  },

  async pfp() {
    const list = await fonts([["Anton", "Anton", 400, "SW"]]);
    return render(
      <div style={{ width: P, height: P, display: "flex", alignItems: "center", justifyContent: "center", background: FN.paper, fontFamily: "Anton" }}>
        <div style={{ width: 384, height: 384, borderRadius: 192, background: FN.red, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div style={{ position: "absolute", left: 20, top: 20, width: 344, height: 344, borderRadius: 172, border: `7px solid ${FN.paper}`, display: "flex" }} />
          <Pic src={star(FN.paper, 34)} x={127} y={62} w={34} h={34} />
          <Pic src={star(FN.paper, 34)} x={175} y={52} w={34} h={34} />
          <Pic src={star(FN.paper, 34)} x={223} y={62} w={34} h={34} />
          <span style={{ fontSize: 214, color: FN.paper, lineHeight: 1, marginTop: 34, letterSpacing: -2 }}>SW</span>
        </div>
      </div>,
      P,
      P,
      list,
    );
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * B. ARCADE: the fighting-game title screen, health bars and all.
 * ───────────────────────────────────────────────────────────────────────── */

const AR = { sky: "#07021a", night: "#1d0638", dusk: "#4a0d58", cyan: "#2fe0ff", pink: "#ff3ea5", ember: "#ff7a1a" };

function synthwave(w: number, h: number, horizon: number, sunR: number, seed: number, grid = true) {
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
  const verticals = grid
    ? Array.from({ length: 41 }, (_, i) => {
        const k = i - 20;
        return `<line x1="${cx + k * 16}" y1="${horizon}" x2="${cx + k * 150}" y2="${h}" stroke="${AR.pink}" stroke-width="2" stroke-opacity="0.55"/>`;
      }).join("")
    : "";
  const horizontals = grid
    ? Array.from({ length: 8 }, (_, i) => {
        const y = horizon + floorH * Math.pow((i + 1) / 8, 1.9);
        return `<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="${AR.pink}" stroke-width="2" stroke-opacity="${(0.25 + 0.4 * ((i + 1) / 8)).toFixed(2)}"/>`;
      }).join("")
    : "";
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AR.sky}"/><stop offset="0.6" stop-color="${AR.night}"/><stop offset="1" stop-color="${AR.dusk}"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5fb8"/><stop offset="0.55" stop-color="${AR.pink}"/><stop offset="1" stop-color="${AR.ember}"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0433"/><stop offset="1" stop-color="#050010"/></linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AR.pink}" stop-opacity="0"/><stop offset="1" stop-color="${AR.pink}" stop-opacity="0.35"/></linearGradient>
<clipPath id="disc"><circle cx="${cx}" cy="${horizon}" r="${sunR}"/></clipPath>
</defs>
<rect width="${w}" height="${horizon}" fill="url(#sky)"/>${stars}
<circle cx="${cx}" cy="${horizon}" r="${sunR}" fill="url(#sun)"/>${stripes}
<rect y="${horizon - 70}" width="${w}" height="70" fill="url(#haze)"/>
<rect y="${horizon}" width="${w}" height="${floorH}" fill="url(#floor)"/>${verticals}${horizontals}
<rect y="${horizon - 2}" width="${w}" height="4" fill="${AR.pink}"/>
</svg>`);
}

/** Chrome letters with a cyan rim and a magenta extrusion, in three layers. */
function Chrome({ text, size, top, face, skew = -10, spacing = 2 }: { text: string; size: number; top: number; face: string; skew?: number; spacing?: number }) {
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
  // A real box, not a fragment: the renderer sizes a fragment to nothing, and
  // the layers' 100% widths with it.
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

function Health({ label, fillPct, color, align }: { label: string; fillPct: number; color: string; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "flex-end", gap: 8 }}>
      <span style={{ fontSize: 17, color, textShadow: `0 0 10px ${color}` }}>{label}</span>
      <div style={{ display: "flex", justifyContent: align === "left" ? "flex-start" : "flex-end", width: 520, height: 30, border: "4px solid #ffffff", background: "#2a0620" }}>
        <div style={{ display: "flex", width: `${fillPct}%`, height: "100%", backgroundImage: `linear-gradient(180deg, #ffffff 0%, ${color} 35%, ${color} 70%, rgba(0,0,0,0.35) 100%)` }} />
      </div>
    </div>
  );
}

const arcade = {
  async banner() {
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
  },

  async pfp() {
    const list = await fonts([["Russo", "Russo One", 400, "SW"]]);
    const sun = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5fb8"/><stop offset="0.55" stop-color="${AR.pink}"/><stop offset="1" stop-color="${AR.ember}"/></linearGradient></defs>
<rect width="400" height="400" fill="${AR.sky}"/>
<circle cx="200" cy="200" r="178" fill="url(#sun)"/>
${Array.from({ length: 6 }, (_, i) => `<rect x="0" y="${232 + i * 24}" width="400" height="${4 + i * 3}" fill="${AR.sky}"/>`).join("")}
</svg>`);
    return render(
      <div style={{ width: P, height: P, display: "flex", position: "relative" }}>
        <Pic src={sun} x={0} y={0} w={P} h={P} />
        <Chrome text="SW" size={206} top={92} face="Russo" skew={-10} spacing={0} />
      </div>,
      P,
      P,
      list,
    );
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * C. BULLS VS BEARS: the market's own two colours, split by a slash.
 * ───────────────────────────────────────────────────────────────────────── */

const BB = { ground: "#050608", bullBg: "#06180e", bearBg: "#1d0709", bull: "#35f28b", bear: "#ff4d5e", white: "#f4f7f5", dim: "#98a39c" };

type Candle = { x: number; o: number; c: number; hi: number; lo: number };

function series(seed: number, n: number, x0: number, step: number, start: number, drift: number): Candle[] {
  const r = rng(seed);
  let level = start;
  return Array.from({ length: n }, (_, i) => {
    const o = level;
    const c = o + drift + (r() - 0.5) * 60;
    level = c;
    const hi = Math.min(o, c) - 8 - r() * 26;
    const lo = Math.max(o, c) + 8 + r() * 26;
    return { x: x0 + i * step, o, c, hi, lo };
  });
}

function Candles({ list, opacity, width = 24 }: { list: Candle[]; opacity: number; width?: number }) {
  return (
    <div style={fill}>
      {list.map((k) => {
        const color = k.c < k.o ? BB.bull : BB.bear;
        return (
          <div key={k.x} style={{ position: "absolute", left: k.x, top: k.hi, width, height: k.lo - k.hi, display: "flex", justifyContent: "center", opacity }}>
            <div style={{ position: "absolute", left: width / 2 - 1.5, top: 0, width: 3, height: k.lo - k.hi, background: color, display: "flex" }} />
            <div style={{ position: "absolute", left: 0, top: Math.min(k.o, k.c) - k.hi, width, height: Math.max(5, Math.abs(k.o - k.c)), background: color, display: "flex" }} />
          </div>
        );
      })}
    </div>
  );
}

const bullsBears = {
  async banner() {
    const list = await fonts([
      ["Dela", "Dela Gothic One", 400, "STONK WARS"],
      ["Mono", "JetBrains Mono", 700, `BULLS BEARS ▲▼ YOUR STOCK VS THEIRS · LOSER GETS COOKED NVDA +3.12% TSLA −2.40% ${COUNT} STOCKS · STONKWARS.FUN`],
    ]);
    const up = series(11, 14, 36, 44, 440, -24);
    const down = series(23, 14, 872, 44, 70, 24);
    return render(
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: BB.ground, fontFamily: "Mono", color: BB.white }}>
        <div style={{ ...fill, background: BB.bullBg, clipPath: "polygon(0 0, 812px 0, 688px 500px, 0 500px)" }} />
        <div style={{ ...fill, background: BB.bearBg, clipPath: "polygon(812px 0, 1500px 0, 1500px 500px, 688px 500px)" }} />
        <div style={{ ...fill, backgroundImage: "radial-gradient(ellipse 520px 300px at 330px 250px, rgba(53,242,139,0.16), rgba(53,242,139,0) 100%)" }} />
        <div style={{ ...fill, backgroundImage: "radial-gradient(ellipse 520px 300px at 1170px 250px, rgba(255,77,94,0.16), rgba(255,77,94,0) 100%)" }} />
        <Candles list={up} opacity={0.42} />
        <Candles list={down} opacity={0.42} />
        <div style={{ position: "absolute", left: 747, top: -12, width: 7, height: 524, background: BB.white, transform: "rotate(13.9deg)", boxShadow: "0 0 26px rgba(255,255,255,0.65)", display: "flex" }} />

        <div style={{ position: "absolute", left: 0, top: 104, width: 722, display: "flex", justifyContent: "flex-end", fontSize: 22, letterSpacing: 8, color: BB.bull }}>▲ BULLS</div>
        <div style={{ position: "absolute", left: 0, top: 134, width: 722, display: "flex", justifyContent: "flex-end", fontFamily: "Dela", fontSize: 124, lineHeight: 1, color: BB.bull, textShadow: "0 9px 0 #000, 0 0 48px rgba(53,242,139,0.45)" }}>
          STONK
        </div>
        <div style={{ position: "absolute", left: 786, top: 126, display: "flex", fontSize: 22, letterSpacing: 8, color: BB.bear }}>BEARS ▼</div>
        <div style={{ position: "absolute", left: 786, top: 156, display: "flex", fontFamily: "Dela", fontSize: 124, lineHeight: 1, color: BB.bear, textShadow: "0 9px 0 #000, 0 0 48px rgba(255,77,94,0.45)" }}>
          WARS
        </div>

        <div style={{ position: "absolute", left: 0, top: 328, width: W, height: 56, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.78)", fontSize: 24, letterSpacing: 5 }}>
          YOUR STOCK VS THEIRS · LOSER GETS COOKED
        </div>
        <div style={{ position: "absolute", left: 470, top: 60, display: "flex", fontSize: 20, color: BB.bull }}>NVDA +3.12%</div>
        <div style={{ position: "absolute", left: 1232, top: 76, display: "flex", fontSize: 20, color: BB.bear }}>TSLA −2.40%</div>
        <div style={{ position: "absolute", right: 40, bottom: 34, display: "flex", fontSize: 18, letterSpacing: 3, color: BB.dim }}>{`${COUNT} STOCKS · STONKWARS.FUN`}</div>
      </div>,
      W,
      H,
      list,
    );
  },

  async pfp() {
    const candle = (color: string, angle: number, gap: boolean) => (
      <div style={{ position: "absolute", left: 165, top: 38, width: 70, height: 324, display: "flex", flexDirection: "column", alignItems: "center", transform: `rotate(${angle}deg)` }}>
        <div style={{ width: 13, height: 58, background: color, display: "flex" }} />
        <div style={{ width: 70, height: 208, background: color, borderRadius: 6, display: "flex", boxShadow: gap ? `0 0 0 10px ${BB.ground}, 0 0 40px ${color}` : `0 0 40px ${color}` }} />
        <div style={{ width: 13, height: 58, background: color, display: "flex" }} />
      </div>
    );
    return render(
      <div style={{ width: P, height: P, display: "flex", position: "relative", background: BB.ground }}>
        <div style={{ ...fill, backgroundImage: "radial-gradient(circle at 30% 50%, rgba(53,242,139,0.18), rgba(0,0,0,0) 55%), radial-gradient(circle at 70% 50%, rgba(255,77,94,0.18), rgba(0,0,0,0) 55%)" }} />
        {candle(BB.bear, 38, false)}
        {candle(BB.bull, -38, true)}
      </div>,
      P,
      P,
      [],
    );
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * D. COOKED: the loser's side of the story, on fire.
 * ───────────────────────────────────────────────────────────────────────── */

const CK = { char: "#0b0605", ember: "#ff7a1a", flame: "#ff2d1a", hot: "#fff1e8", ash: "#b9a9a3" };

function flameD(x: number, base: number, fw: number, fh: number) {
  return `M${x.toFixed(1)},${base} C${(x - fw).toFixed(1)},${(base - fh * 0.34).toFixed(1)} ${(x - fw * 0.32).toFixed(1)},${(base - fh * 0.74).toFixed(1)} ${x.toFixed(1)},${(base - fh).toFixed(1)} C${(x + fw * 0.32).toFixed(1)},${(base - fh * 0.74).toFixed(1)} ${(x + fw).toFixed(1)},${(base - fh * 0.34).toFixed(1)} ${x.toFixed(1)},${base} Z`;
}

function fire(w: number, h: number, seed: number) {
  const r = rng(seed);
  const layer = (n: number, minH: number, maxH: number, minW: number, maxW: number, grad: string) =>
    Array.from({ length: n }, (_, i) => {
      const x = (i + 0.2 + r() * 0.6) * (w / n);
      return `<path d="${flameD(x, h + 10, minW + r() * (maxW - minW), minH + r() * (maxH - minH))}" fill="url(#${grad})"/>`;
    }).join("");
  const embers = Array.from({ length: 34 }, () => `<circle cx="${(r() * w).toFixed(1)}" cy="${(h - 140 - r() * 220).toFixed(1)}" r="${(1 + r() * 2.2).toFixed(2)}" fill="${CK.ember}" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`).join("");
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="red" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CK.flame}" stop-opacity="0.95"/><stop offset="0.6" stop-color="${CK.flame}" stop-opacity="0.55"/><stop offset="1" stop-color="${CK.flame}" stop-opacity="0"/></linearGradient>
<linearGradient id="orange" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CK.ember}"/><stop offset="0.65" stop-color="${CK.ember}" stop-opacity="0.6"/><stop offset="1" stop-color="${CK.ember}" stop-opacity="0"/></linearGradient>
<linearGradient id="hot" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CK.hot}"/><stop offset="0.5" stop-color="#ffb489"/><stop offset="1" stop-color="${CK.ember}" stop-opacity="0"/></linearGradient>
<linearGradient id="glow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CK.flame}" stop-opacity="0.55"/><stop offset="1" stop-color="${CK.flame}" stop-opacity="0"/></linearGradient>
</defs>
<rect y="${h - 260}" width="${w}" height="260" fill="url(#glow)"/>
${layer(Math.round(w / 64), 150, 300, 40, 80, "red")}
${layer(Math.round(w / 52), 90, 200, 30, 60, "orange")}
${layer(Math.round(w / 44), 40, 110, 18, 38, "hot")}
${embers}
</svg>`);
}

const cooked = {
  async banner() {
    const r = rng(20260911);
    const rows = Array.from({ length: 5 }, (_, row) =>
      Array.from({ length: 9 }, (_, i) => ({ t: ROSTER[(row * 7 + i * 5) % 60].ticker, m: -(0.4 + r() * 6.5) })),
    );
    const list = await fonts([
      ["Burned", "Rubik Burned", 400, "STONK WARS"],
      ["Display", "Big Shoulders", 900, `YOUR STOCK VS THEIRS. LOSER GETS COOKED. ${COUNT} STOCKS · STONKWARS.FUN ${rows.flat().map((c) => c.t).join(" ")} -.%0123456789`],
      ["Stencil", "Big Shoulders Stencil", 900, "COOKED"],
    ]);
    return render(
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: CK.char, fontFamily: "Display", color: CK.hot, textTransform: "uppercase" }}>
        <div style={{ position: "absolute", left: -40, top: 4, display: "flex", flexDirection: "column" }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", height: 64, alignItems: "baseline", marginLeft: i % 2 ? 80 : 0 }}>
              {row.map((c, j) => (
                <div key={j} style={{ display: "flex", alignItems: "baseline", width: 184 }}>
                  <span style={{ fontSize: 36, opacity: 0.06 }}>{c.t}</span>
                  <span style={{ fontSize: 22, marginLeft: 8, color: CK.flame, opacity: 0.2 }}>{`-${Math.abs(c.m).toFixed(2)}%`}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <Pic src={await raster(fire(W, H, 5))} x={0} y={0} w={W} h={H} />

        <div style={{ position: "absolute", left: 0, top: 66, width: "100%", display: "flex", justifyContent: "center", fontFamily: "Burned", fontSize: 138, lineHeight: 1, color: CK.flame, textShadow: `0 0 10px ${CK.char}, 0 0 34px rgba(255,90,20,0.75)` }}>
          STONK WARS
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 66,
            width: "100%",
            display: "flex",
            justifyContent: "center",
            fontFamily: "Burned",
            fontSize: 138,
            lineHeight: 1,
            color: "transparent",
            backgroundImage: `linear-gradient(180deg, ${CK.hot} 8%, #ffb489 38%, ${CK.ember} 62%, ${CK.flame} 100%)`,
            backgroundClip: "text",
          }}
        >
          STONK WARS
        </div>
        <div style={{ position: "absolute", left: 0, top: 228, width: "100%", display: "flex", justifyContent: "center", fontSize: 50, letterSpacing: 1, textShadow: `0 0 14px ${CK.char}` }}>
          <span>Your stock vs theirs.</span>
          <span style={{ color: CK.ember, marginLeft: 16 }}>Loser gets cooked.</span>
        </div>
        <div
          style={{
            position: "absolute",
            left: 1250,
            top: 132,
            display: "flex",
            border: `7px solid ${CK.ember}`,
            color: CK.ember,
            fontFamily: "Stencil",
            fontSize: 70,
            lineHeight: 1,
            padding: "6px 16px 2px",
            transform: "rotate(-13deg)",
            opacity: 0.92,
          }}
        >
          COOKED
        </div>
        <div style={{ position: "absolute", right: 44, top: 36, display: "flex", fontSize: 22, letterSpacing: 3, color: CK.ash }}>{`${COUNT} STOCKS · STONKWARS.FUN`}</div>
      </div>,
      W,
      H,
      list,
    );
  },

  async pfp() {
    const art = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<defs>
<radialGradient id="glow" cx="0.5" cy="0.42" r="0.55"><stop offset="0" stop-color="${CK.flame}" stop-opacity="0.45"/><stop offset="1" stop-color="${CK.flame}" stop-opacity="0"/></radialGradient>
<linearGradient id="outer" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CK.flame}"/><stop offset="0.55" stop-color="${CK.ember}"/><stop offset="1" stop-color="#ff9a5c"/></linearGradient>
<linearGradient id="inner" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${CK.hot}"/><stop offset="1" stop-color="#ffc3a0"/></linearGradient>
<linearGradient id="body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c8141f"/><stop offset="0.45" stop-color="#ff3b3b"/><stop offset="1" stop-color="#a50f18"/></linearGradient>
</defs>
<rect width="400" height="400" fill="${CK.char}"/>
<rect width="400" height="400" fill="url(#glow)"/>
<rect x="194" y="318" width="12" height="52" fill="#d3141f"/>
<rect x="152" y="214" width="96" height="112" rx="6" fill="url(#body)"/>
<path d="M200,30 C252,92 274,128 272,170 C270,212 240,236 200,236 C160,236 130,212 128,170 C126,130 152,102 172,78 C174,110 187,128 202,132 C214,102 214,66 200,30 Z" fill="url(#outer)"/>
<path d="M200,116 C224,146 234,166 232,188 C230,210 217,222 200,222 C183,222 170,210 168,188 C166,166 180,146 200,116 Z" fill="url(#inner)"/>
</svg>`);
    return render(
      <div style={{ width: P, height: P, display: "flex", position: "relative" }}>
        <Pic src={art} x={0} y={0} w={P} h={P} />
      </div>,
      P,
      P,
      [],
    );
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * E. COMIC POP: the group-chat argument, as a comic panel.
 * ───────────────────────────────────────────────────────────────────────── */

const CP = { pink: "#ff3ea5", cyan: "#2fe0ff", ink: "#111014", paper: "#ffffff", dotPink: "#d81f86", dotCyan: "#0fb3d4" };

function comicPanels(w: number, h: number) {
  const burst = (dx: number, dy: number) => starPoints(750 + dx, 250 + dy, 1, 1, 24, 0, 1);
  // An elliptical burst: stretch a unit star by hand.
  const ellipseBurst = (cx: number, cy: number, rx: number, ry: number, inner: number, seed: number) => {
    const r = rng(seed);
    return Array.from({ length: 48 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 24;
      const k = i % 2 ? inner : 1;
      const j = 1 + (r() - 0.5) * 0.14;
      return `${(cx + Math.cos(a) * rx * k * j).toFixed(1)},${(cy + Math.sin(a) * ry * k * j).toFixed(1)}`;
    }).join(" ");
  };
  void burst;
  const left = "14,14 792,14 714,486 14,486";
  const right = "814,14 1486,14 1486,486 736,486";
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<pattern id="dc" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="4.6" fill="${CP.dotCyan}"/></pattern>
<pattern id="dp" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="4.6" fill="${CP.dotPink}"/></pattern>
</defs>
<rect width="${w}" height="${h}" fill="${CP.paper}"/>
<polygon points="${left}" fill="${CP.cyan}"/><polygon points="${left}" fill="url(#dc)" opacity="0.6"/>
<polygon points="${right}" fill="${CP.pink}"/><polygon points="${right}" fill="url(#dp)" opacity="0.6"/>
<polygon points="${left}" fill="none" stroke="${CP.ink}" stroke-width="8" stroke-linejoin="miter"/>
<polygon points="${right}" fill="none" stroke="${CP.ink}" stroke-width="8" stroke-linejoin="miter"/>
<polygon points="${ellipseBurst(764, 262, 400, 230, 0.74, 3)}" fill="${CP.ink}"/>
<polygon points="${ellipseBurst(750, 250, 400, 230, 0.74, 3)}" fill="${CP.paper}" stroke="${CP.ink}" stroke-width="7" stroke-linejoin="round"/>
<polygon points="286,122 344,122 392,178" fill="${CP.paper}" stroke="${CP.ink}" stroke-width="5" stroke-linejoin="round"/>
<ellipse cx="226" cy="84" rx="194" ry="60" fill="${CP.paper}" stroke="${CP.ink}" stroke-width="5"/>
<polygon points="290,116 340,116 382,166" fill="${CP.paper}"/>
<polygon points="1244,118 1296,118 1206,170" fill="${CP.paper}" stroke="${CP.ink}" stroke-width="5" stroke-linejoin="round"/>
<ellipse cx="1300" cy="80" rx="136" ry="54" fill="${CP.paper}" stroke="${CP.ink}" stroke-width="5"/>
<polygon points="1248,112 1292,112 1216,160" fill="${CP.paper}"/>
</svg>`);
}

const comic = {
  async banner() {
    const list = await fonts([["Bangers", "Bangers", 400, `NVDA EATS TSLA THIS WEEK. BET. STONK WARS YOUR STOCK VS THEIRS. LOSER GETS COOKED. STONKWARS.FUN ${COUNT} STOCKS`]]);
    const title: CSSProperties = {
      position: "absolute",
      left: 0,
      top: 150,
      width: "100%",
      display: "flex",
      justifyContent: "center",
      fontSize: 176,
      lineHeight: 1,
      letterSpacing: 3,
      transform: "rotate(-4deg)",
    };
    return render(
      <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Bangers", color: CP.ink }}>
        <Pic src={comicPanels(W, H)} x={0} y={0} w={W} h={H} />
        <div style={{ position: "absolute", left: 40, top: 40, width: 372, height: 90, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 34, lineHeight: 1 }}>
          <span>NVDA EATS TSLA</span>
          <span>THIS WEEK.</span>
        </div>
        <div style={{ position: "absolute", left: 1164, top: 30, width: 272, height: 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, lineHeight: 1 }}>BET.</div>
        <div style={{ ...title, top: 162, color: CP.ink }}>
          <span style={{ marginLeft: 20 }}>STONK</span>
          <span style={{ marginLeft: 30 }}>WARS</span>
        </div>
        <div style={{ ...title, WebkitTextStroke: `9px ${CP.ink}` }}>
          <span style={{ color: CP.pink }}>STONK</span>
          <span style={{ color: CP.cyan, marginLeft: 30 }}>WARS</span>
        </div>
        <div style={{ ...title }}>
          <span style={{ color: CP.pink }}>STONK</span>
          <span style={{ color: CP.cyan, marginLeft: 30 }}>WARS</span>
        </div>
        <div style={{ position: "absolute", left: 452, top: 398, width: 596, height: 60, display: "flex", alignItems: "center", justifyContent: "center", background: CP.ink, color: CP.paper, fontSize: 32, letterSpacing: 1.5, border: `4px solid ${CP.paper}`, transform: "rotate(-1.5deg)" }}>
          YOUR STOCK VS THEIRS. LOSER GETS COOKED.
        </div>
        <div style={{ position: "absolute", right: 42, bottom: 38, display: "flex", background: CP.paper, border: `4px solid ${CP.ink}`, padding: "4px 12px 2px", fontSize: 28, letterSpacing: 1 }}>STONKWARS.FUN</div>
      </div>,
      W,
      H,
      list,
    );
  },

  async pfp() {
    const list = await fonts([["Bangers", "Bangers", 400, "SW"]]);
    const r = rng(9);
    const pts = Array.from({ length: 36 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 18;
      const k = (i % 2 ? 0.7 : 1) * (1 + (r() - 0.5) * 0.12);
      return `${(200 + Math.cos(a) * 176 * k).toFixed(1)},${(206 + Math.sin(a) * 176 * k).toFixed(1)}`;
    }).join(" ");
    const art = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<defs><pattern id="dp" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="4.2" fill="${CP.dotPink}"/></pattern></defs>
<rect width="400" height="400" fill="${CP.pink}"/><rect width="400" height="400" fill="url(#dp)" opacity="0.6"/>
<polygon points="${pts}" transform="translate(10 10)" fill="${CP.ink}"/>
<polygon points="${pts}" fill="${CP.paper}" stroke="${CP.ink}" stroke-width="7" stroke-linejoin="round"/>
</svg>`);
    return render(
      <div style={{ width: P, height: P, display: "flex", position: "relative", fontFamily: "Bangers" }}>
        <Pic src={art} x={0} y={0} w={P} h={P} />
        <div style={{ position: "absolute", left: 0, top: 96, width: "100%", display: "flex", justifyContent: "center", fontSize: 200, lineHeight: 1, color: CP.ink, textShadow: `10px 10px 0 ${CP.cyan}`, transform: "rotate(-6deg)" }}>SW</div>
      </div>,
      P,
      P,
      list,
    );
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * F. NEON: a sign on a wall, open 24/5 like the tokens.
 * ───────────────────────────────────────────────────────────────────────── */

const NE = { wall: "#0f0913", brick: "#191020", cyan: "#2fe0ff", pink: "#ff3ea5", coreC: "#e4fdff", coreP: "#ffe6f4" };

function bricks(w: number, h: number) {
  const rows = Math.ceil(h / 30);
  let out = "";
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? 0 : -40;
    for (let x = off; x < w; x += 80) out += `<rect x="${x + 2}" y="${row * 30 + 2}" width="76" height="26" rx="3" fill="${NE.brick}"/>`;
  }
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${NE.wall}"/>${out}</svg>`);
}

const glow = (core: string, color: string) => ({
  color: core,
  textShadow: `0 0 4px #ffffff, 0 0 10px ${color}, 0 0 22px ${color}, 0 0 44px ${color}, 0 0 80px ${color}`,
});

function neonMark(stroke = 2.6) {
  const lines = (a: string, b: string, s: number) => `<polyline points="4,27 10,19 14,22 25,7" stroke="${a}" stroke-width="${s}"/>
<polyline points="21,6 26,6 26,11" stroke="${a}" stroke-width="${s}"/>
<polyline points="28,27 22,19 18,22 7,7" stroke="${b}" stroke-width="${s}"/>
<polyline points="11,6 6,6 6,11" stroke="${b}" stroke-width="${s}"/>`;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 40 40" fill="none" stroke-linecap="round" stroke-linejoin="round">
<defs><filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<g filter="url(#g)">${lines(NE.cyan, NE.pink, stroke)}</g>
<g>${lines(NE.coreC, NE.coreP, stroke * 0.38)}</g>
</svg>`);
}

const neon = {
  async banner() {
    const list = await fonts([
      ["Tube", "Tilt Neon", 400, `STONK WARS YOUR STOCK VS THEIRS · LOSER GETS COOKED OPEN 24/5 STONKWARS.FUN ${COUNT} STOCKS`],
    ]);
    return render(
      <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Tube" }}>
        <Pic src={bricks(W, H)} x={0} y={0} w={W} h={H} />
        <div style={{ ...fill, backgroundImage: "radial-gradient(ellipse 760px 300px at 750px 215px, rgba(255,62,165,0.16), rgba(15,9,19,0) 100%)" }} />
        <div style={{ ...fill, backgroundImage: "radial-gradient(ellipse 1000px 520px at 750px 250px, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%)" }} />
        <Pic src={neonMark()} x={62} y={40} w={132} h={132} />
        <div style={{ position: "absolute", left: 0, top: 104, width: "100%", display: "flex", justifyContent: "center", fontSize: 176, lineHeight: 1, letterSpacing: 4 }}>
          <span style={glow(NE.coreC, NE.cyan)}>STONK</span>
          <span style={{ ...glow(NE.coreP, NE.pink), marginLeft: 36 }}>WARS</span>
        </div>
        <div style={{ position: "absolute", left: 0, top: 318, width: "100%", display: "flex", justifyContent: "center", fontSize: 38, letterSpacing: 3, ...glow(NE.coreP, NE.pink) }}>
          YOUR STOCK VS THEIRS · LOSER GETS COOKED
        </div>
        <div
          style={{
            position: "absolute",
            left: 1204,
            top: 44,
            width: 236,
            height: 88,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 16,
            border: `4px solid ${NE.coreP}`,
            boxShadow: `0 0 10px ${NE.pink}, 0 0 26px ${NE.pink}, inset 0 0 14px ${NE.pink}`,
            fontSize: 44,
            letterSpacing: 2,
            ...glow(NE.coreP, NE.pink),
          }}
        >
          OPEN 24/5
        </div>
        <div style={{ position: "absolute", right: 46, bottom: 36, display: "flex", fontSize: 26, letterSpacing: 3, ...glow(NE.coreC, NE.cyan) }}>{`${COUNT} STOCKS · STONKWARS.FUN`}</div>
      </div>,
      W,
      H,
      list,
    );
  },

  async pfp() {
    return render(
      <div style={{ width: P, height: P, display: "flex", position: "relative" }}>
        <Pic src={bricks(P, P)} x={0} y={0} w={P} h={P} />
        <div style={{ ...fill, backgroundImage: "radial-gradient(circle at 50% 50%, rgba(255,62,165,0.2), rgba(0,0,0,0.55) 75%)" }} />
        <Pic src={neonMark(2.9)} x={40} y={40} w={320} h={320} />
      </div>,
      P,
      P,
      [],
    );
  },
};

export const DIRECTIONS: Record<string, { banner: () => Promise<ImageResponse>; pfp: () => Promise<ImageResponse> }> = {
  "fight-night": fightNight,
  arcade,
  "bulls-bears": bullsBears,
  cooked,
  comic,
  neon,
};
