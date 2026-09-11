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

/** The night, the sun and the grid floor, as one image. */
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
<circle cx="${cx}" cy="${horizon}" r="${sunR}" fill="url(#sun)"/>${stripes}
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
