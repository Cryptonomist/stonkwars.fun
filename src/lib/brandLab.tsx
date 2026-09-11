/* Brand lab: alternative directions for the X profile picture and header,
 * drawn with the same engine as the real assets, so whichever is picked
 * exports as it looks. Served at /brand/lab/<direction>/{pfp,banner}.png.
 *
 * Every direction keeps the header's bottom-left corner free of anything that
 * must be read: on a desktop profile the round profile picture covers it. */

import type { ImageResponse } from "next/og";
import type { CSSProperties } from "react";

import {
  AR,
  arcadeBanner,
  Chrome,
  fill,
  fonts,
  H,
  P,
  Pic,
  raster,
  render,
  rng,
  svg,
  W,
} from "@/lib/brandArt";
import { ROSTER } from "@/lib/stocks";

const COUNT = ROSTER.length.toLocaleString("en-US");

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
 * B. ARCADE: the fighting-game title screen, health bars and all. Chosen, so
 * the header itself now lives in lib/brandArt.tsx; what is left here is the
 * lettered profile picture it was first shown with.
 * ───────────────────────────────────────────────────────────────────────── */

const arcade = {
  banner: arcadeBanner,

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

/* ─────────────────────────────────────────────────────────────────────────
 * Arcade, without letters: five marks for the same title screen. Each is one
 * silhouette at feed size, so it survives being 40 pixels wide.
 * ───────────────────────────────────────────────────────────────────────── */

/** The arcade's world as a square: night sky, stars, horizon, grid, and the
 * sun when a mark wants one behind it. */
function arcadeGround(sun: boolean, horizon = 296) {
  const r = rng(4);
  const stars = Array.from({ length: 26 }, () => {
    const x = r() * P;
    const y = r() * (horizon - 40);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.9 + r() * 1.5).toFixed(2)}" fill="#fff" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
  }).join("");
  const grid = `${Array.from({ length: 15 }, (_, i) => {
    const k = i - 7;
    return `<line x1="${200 + k * 14}" y1="${horizon}" x2="${200 + k * 92}" y2="${P}" stroke="${AR.pink}" stroke-width="2" stroke-opacity="0.5"/>`;
  }).join("")}${Array.from({ length: 5 }, (_, i) => {
    const y = horizon + (P - horizon) * Math.pow((i + 1) / 5, 1.9);
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${P}" y2="${y.toFixed(1)}" stroke="${AR.pink}" stroke-width="2" stroke-opacity="${(0.3 + 0.35 * ((i + 1) / 5)).toFixed(2)}"/>`;
  }).join("")}`;
  return `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AR.sky}"/><stop offset="0.62" stop-color="${AR.night}"/><stop offset="1" stop-color="#3d0a4e"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5fb8"/><stop offset="0.55" stop-color="${AR.pink}"/><stop offset="1" stop-color="${AR.ember}"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0433"/><stop offset="1" stop-color="#050010"/></linearGradient>
<linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.34" stop-color="#e6ecf7"/><stop offset="0.5" stop-color="#8e9bb6"/><stop offset="0.54" stop-color="#39435e"/><stop offset="0.6" stop-color="#cfd8e8"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<linearGradient id="cyanBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9df4ff"/><stop offset="0.45" stop-color="${AR.cyan}"/><stop offset="1" stop-color="#0f86a8"/></linearGradient>
<linearGradient id="pinkBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9ad2"/><stop offset="0.45" stop-color="${AR.pink}"/><stop offset="1" stop-color="#b3175f"/></linearGradient>
</defs>
<rect width="${P}" height="${horizon}" fill="url(#sky)"/>${stars}
${sun ? `<circle cx="200" cy="${horizon}" r="168" fill="url(#sun)"/>${Array.from({ length: 5 }, (_, i) => `<rect x="32" y="${horizon - 96 + i * 17}" width="336" height="${(3 + i * 1.7).toFixed(1)}" fill="#2c0840"/>`).join("")}` : ""}
<rect y="${horizon}" width="${P}" height="${P - horizon}" fill="url(#floor)"/>${grid}
<rect y="${horizon - 2}" width="${P}" height="4" fill="${AR.pink}"/>`;
}

/** A candlestick: wick, body, wick, upright, ready to be rotated. */
function candleShape(cx: number, cy: number, bodyH: number, wick: number, w: number, fillId: string, outline: string) {
  const bodyTop = cy - bodyH / 2;
  return `<g>
<rect x="${cx - 11}" y="${bodyTop - wick}" width="22" height="${bodyH + wick * 2}" rx="3" fill="${outline}"/>
<rect x="${cx - 8}" y="${bodyTop - wick + 3}" width="16" height="${bodyH + wick * 2 - 6}" rx="2" fill="url(#${fillId})"/>
<rect x="${cx - w / 2 - 7}" y="${bodyTop - 7}" width="${w + 14}" height="${bodyH + 14}" rx="6" fill="${outline}"/>
<rect x="${cx - w / 2}" y="${bodyTop}" width="${w}" height="${bodyH}" rx="3" fill="url(#${fillId})"/>
</g>`;
}

const logoImage = async (markup: string) =>
  raster(svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${P}" height="${P}" viewBox="0 0 ${P} ${P}">${markup}</svg>`));

const sparkPoints = (cx: number, cy: number, outer: number, inner: number, spikes = 8) => starPoints(cx, cy, outer, inner, spikes);

const arcadeLogo = (markup: string) => ({
  banner: arcade.banner,
  async pfp() {
    return render(
      <div style={{ width: P, height: P, display: "flex", position: "relative" }}>
        <Pic src={await logoImage(markup)} x={0} y={0} w={P} h={P} />
      </div>,
      P,
      P,
      [],
    );
  },
});

const OUTLINE = "#08021c";

/* Each mark is two shapes and a spark at most: at 40 pixels a third shape is
 * mud. The grid keeps the arcade's floor without competing. */
const arcadeCandles = arcadeLogo(`${arcadeGround(false, 330)}
<g transform="rotate(34 200 190)">${candleShape(200, 190, 212, 52, 104, "pinkBody", OUTLINE)}</g>
<g transform="rotate(-34 200 190)">${candleShape(200, 190, 212, 52, 104, "cyanBody", OUTLINE)}</g>
<polygon points="${sparkPoints(200, 190, 52, 15)}" fill="${OUTLINE}"/>
<polygon points="${sparkPoints(200, 190, 44, 13)}" fill="#ffffff"/>`);

const arcadeSun = arcadeLogo(`${arcadeGround(true, 330)}
<g fill="${OUTLINE}">
${[
  { x: 92, h: 92, y: 210 },
  { x: 164, h: 150, y: 152 },
  { x: 236, h: 116, y: 118 },
  { x: 308, h: 176, y: 62 },
]
  .map(
    (c) =>
      `<rect x="${c.x - 7}" y="${c.y - 30}" width="14" height="${c.h + 60}" rx="7"/><rect x="${c.x - 27}" y="${c.y}" width="54" height="${c.h}" rx="8"/>`,
  )
  .join("")}
</g>`);

/* The crossed rising charts of the live mark, rebuilt in chrome: square caps
 * and solid arrowheads, so the shape stays sharp when it shrinks. */
const chartLine = (points: string, head: string, width: number, stroke: string, headFill: string) =>
  `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square" stroke-linejoin="miter"/><polygon points="${head}" fill="${headFill}"/>`;

const arcadeArrows = arcadeLogo(`${arcadeGround(false, 330)}
<g>
${chartLine("62,292 130,196 184,234 300,66", "238,40 340,40 340,142 306,108 306,74 272,74", 54, OUTLINE, OUTLINE)}
${chartLine("338,292 270,196 216,234 100,66", "162,40 60,40 60,142 94,108 94,74 128,74", 54, OUTLINE, OUTLINE)}
${chartLine("338,292 270,196 216,234 100,66", "156,46 66,46 66,136 96,106 96,76 126,76", 34, "url(#chrome)", "url(#chrome)")}
${chartLine("62,292 130,196 184,234 300,66", "244,46 334,46 334,136 304,106 304,76 274,76", 34, "url(#chrome)", "url(#chrome)")}
${chartLine("338,292 270,196 216,234 100,66", "150,54 76,54 76,128 98,106 98,80 120,80", 10, AR.pink, AR.pink)}
${chartLine("62,292 130,196 184,234 300,66", "250,54 324,54 324,128 302,106 302,80 280,80", 10, AR.cyan, AR.cyan)}
</g>`);

const arcadeClash = arcadeLogo(`${arcadeGround(false, 330)}
<g stroke-linejoin="round">
<polygon points="10,200 126,84 126,140 196,140 196,260 126,260 126,316" fill="${OUTLINE}"/>
<polygon points="28,200 136,94 136,150 186,150 186,250 136,250 136,306" fill="url(#cyanBody)"/>
<polygon points="390,200 274,84 274,140 204,140 204,260 274,260 274,316" fill="${OUTLINE}"/>
<polygon points="372,200 264,94 264,150 214,150 214,250 264,250 264,306" fill="url(#pinkBody)"/>
</g>
<polygon points="${sparkPoints(200, 200, 104, 32, 10)}" fill="${OUTLINE}"/>
<polygon points="${sparkPoints(200, 200, 92, 28, 10)}" fill="#ffffff"/>`);

/* ─────────────────────────────────────────────────────────────────────────
 * The crossed candles on their own ground: the mark should not repeat the
 * header behind it, and the pair of colours is worth arguing about.
 *
 * The fighters' two colours must never be the market's green and red: those
 * already mean up and down on every screen, so a green fighter whose stock is
 * falling would read as a bug.
 * ───────────────────────────────────────────────────────────────────────── */

type Ground = "void" | "coin" | "paper" | "cabinet";
type Pair = { a: string; aDark: string; b: string; bDark: string; chrome?: boolean };

const PAIRS: Record<string, Pair> = {
  // Cyan and pink: neutral, and what the app already runs on.
  cyanpink: { a: "#2fe0ff", aDark: "#0f86a8", b: "#ff3ea5", bDark: "#b3175f" },
  // The arcade's own convention: player one red, player two blue.
  players: { a: "#ff2f45", aDark: "#a5101f", b: "#3d7bff", bDark: "#15379b" },
  // The market's colours. Clear, but they collide with up and down.
  market: { a: "#35f28b", aDark: "#12a158", b: "#ff4d5e", bDark: "#a81828" },
  // Chrome against one hot accent: the metal does the talking.
  chrome: { a: "#dfe6f2", aDark: "#5b6478", b: "#ff3ea5", bDark: "#b3175f", chrome: true },
};

function markGround(kind: Ground, pair: Pair) {
  const glow = `<radialGradient id="ga" cx="0.32" cy="0.42" r="0.5"><stop offset="0" stop-color="${pair.a}" stop-opacity="0.3"/><stop offset="1" stop-color="${pair.a}" stop-opacity="0"/></radialGradient>
<radialGradient id="gb" cx="0.68" cy="0.58" r="0.5"><stop offset="0" stop-color="${pair.b}" stop-opacity="0.3"/><stop offset="1" stop-color="${pair.b}" stop-opacity="0"/></radialGradient>`;
  if (kind === "paper") {
    return {
      defs: "",
      body: `<rect width="${P}" height="${P}" fill="#f5f4ef"/>`,
      outline: "#0c0c0d",
      spark: "#0c0c0d",
    };
  }
  if (kind === "coin") {
    return {
      defs: glow,
      body: `<rect width="${P}" height="${P}" fill="#08080d"/><circle cx="200" cy="200" r="194" fill="url(#chrome)"/><circle cx="200" cy="200" r="162" fill="#0a0a12"/><rect width="${P}" height="${P}" fill="url(#ga)"/><rect width="${P}" height="${P}" fill="url(#gb)"/>`,
      outline: "#0a0a12",
      spark: "#ffffff",
    };
  }
  if (kind === "cabinet") {
    const lines = Array.from({ length: 50 }, (_, i) => `<rect y="${i * 8}" width="${P}" height="2" fill="#ffffff" opacity="0.05"/>`).join("");
    return {
      defs: glow,
      body: `<rect width="${P}" height="${P}" fill="#160a26"/><rect width="${P}" height="${P}" fill="url(#ga)"/><rect width="${P}" height="${P}" fill="url(#gb)"/>${lines}`,
      outline: "#120820",
      spark: "#ffffff",
    };
  }
  return {
    defs: glow,
    body: `<rect width="${P}" height="${P}" fill="#07070b"/><rect width="${P}" height="${P}" fill="url(#ga)"/><rect width="${P}" height="${P}" fill="url(#gb)"/>`,
    outline: "#07070b",
    spark: "#ffffff",
  };
}

function candleMark(kind: Ground, pairName: string) {
  const pair = PAIRS[pairName];
  const g = markGround(kind, pair);
  const body = (id: string, light: string, dark: string) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.45" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
  const chromeGrad = `<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#e2e9f6"/><stop offset="0.5" stop-color="#8b97b1"/><stop offset="0.56" stop-color="#39435e"/><stop offset="0.72" stop-color="#d7dfee"/><stop offset="1" stop-color="#ffffff"/></linearGradient>`;
  return `<defs>${chromeGrad}${body("bodyA", pair.a, pair.aDark)}${body("bodyB", pair.b, pair.bDark)}${g.defs}</defs>
${g.body}
<g transform="rotate(34 200 200)">${candleShape(200, 200, 214, 54, 106, "bodyB", g.outline)}</g>
<g transform="rotate(-34 200 200)">${candleShape(200, 200, 214, 54, 106, pair.chrome ? "chrome" : "bodyA", g.outline)}</g>
<polygon points="${sparkPoints(200, 200, 54, 16)}" fill="${g.outline}"/>
<polygon points="${sparkPoints(200, 200, 46, 14)}" fill="${g.spark}"/>`;
}

const markVariants: Record<string, { banner: () => Promise<ImageResponse>; pfp: () => Promise<ImageResponse> }> = {};
for (const [kind, pairs] of [
  ["void", ["cyanpink", "players", "market", "chrome"]],
  ["coin", ["cyanpink"]],
  ["paper", ["cyanpink", "market"]],
  ["cabinet", ["cyanpink"]],
] as [Ground, string[]][]) {
  for (const pair of pairs) markVariants[`mark-${kind}-${pair}`] = arcadeLogo(candleMark(kind, pair));
}

export const DIRECTIONS: Record<string, { banner: () => Promise<ImageResponse>; pfp: () => Promise<ImageResponse> }> = {
  ...markVariants,
  "fight-night": fightNight,
  arcade,
  "bulls-bears": bullsBears,
  cooked,
  comic,
  neon,
  "arcade-candles": arcadeCandles,
  "arcade-sun": arcadeSun,
  "arcade-arrows": arcadeArrows,
  "arcade-clash": arcadeClash,
};
