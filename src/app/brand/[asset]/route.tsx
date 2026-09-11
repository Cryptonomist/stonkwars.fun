/* Brand assets, drawn from the same code as the share cards so the type and
 * colours can never drift from the site:
 *
 *   /brand/pfp.png     400x400, the mark, for the X profile (cropped to a circle)
 *   /brand/banner.png  1500x500, the X header (bottom-left kept clear: the
 *                      profile picture sits over it on desktop)
 */

import { ImageResponse } from "next/og";

import { BRAND } from "@/lib/brand";
import { loadGoogleFont } from "@/lib/ogFont";

const C = {
  void: "#07070b",
  line: "#25253a",
  ink: "#f3f3f8",
  dim: "#9090a8",
  p1: "#2fe0ff",
  p2: "#ff3ea5",
  up: "#35f28b",
  down: "#ff4d5e",
  gold: "#ffd84a",
  cooked: "#ff7a1a",
};

/** The mark, as an SVG data URI: two stock charts crossed like swords. */
function markUri(stroke = 3.2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke-linecap="square" stroke-linejoin="miter">
<polyline points="4,27 10,19 14,22 25,7" stroke="${C.p1}" stroke-width="${stroke}"/>
<polyline points="21,6 26,6 26,11" stroke="${C.p1}" stroke-width="${stroke}"/>
<polyline points="28,27 22,19 18,22 7,7" stroke="${C.p2}" stroke-width="${stroke}"/>
<polyline points="11,6 6,6 6,11" stroke="${C.p2}" stroke-width="${stroke}"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const grid = {
  backgroundImage: `linear-gradient(${C.line}66 1px, transparent 1px), linear-gradient(90deg, ${C.line}66 1px, transparent 1px)`,
  backgroundSize: "40px 40px",
};

async function fonts(text: string) {
  const all = `${text}${text.toUpperCase()}${text.toLowerCase()}`;
  const [display, stencil] = await Promise.all([
    loadGoogleFont("Big Shoulders", 900, all),
    loadGoogleFont("Big Shoulders Stencil", 900, "COOKED"),
  ]);
  return {
    face: display ? "Display" : "sans-serif",
    stencilFace: stencil ? "Stencil" : display ? "Display" : "sans-serif",
    list: [
      ...(display ? [{ name: "Display", data: display, weight: 900 as const, style: "normal" as const }] : []),
      ...(stencil ? [{ name: "Stencil", data: stencil, weight: 900 as const, style: "normal" as const }] : []),
    ],
  };
}

async function pfp() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.void,
          ...grid,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={markUri(3.6)} width={272} height={272} />
      </div>
    ),
    { width: 400, height: 400 },
  );
}

async function banner() {
  const f = await fonts(`STONKWARS YOUR STOCK VS THEIRS. LOSER GETS COOKED. NVDA TSLA +3.12% -0.85% ${BRAND.domain} STAKE REAL SHARES · PYTH DECIDES · SOLANA`);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: C.void,
          ...grid,
          color: C.ink,
          fontFamily: f.face,
          textTransform: "uppercase",
          padding: "50px 70px 50px 330px",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 700 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={markUri(3.4)} width={84} height={84} />
            <div style={{ display: "flex", fontSize: 104, lineHeight: 1, marginLeft: 18 }}>
              <span>STONK</span>
              <span style={{ color: C.gold }}>WARS</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 50, lineHeight: 1, marginTop: 16 }}>
            <span>Your stock vs theirs.</span>
            <span style={{ color: C.cooked, marginTop: 4 }}>Loser gets cooked.</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: C.dim, marginTop: 18 }}>
            Stake real shares · Pyth decides · Solana
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", position: "relative", width: 360 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 92, color: C.p1, lineHeight: 0.9 }}>NVDA</span>
            <span style={{ fontSize: 36, color: C.up, marginLeft: 14 }}>+3.12%</span>
          </div>
          <div style={{ fontSize: 44, color: C.gold, margin: "2px 0" }}>VS</div>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 92, color: C.p2, lineHeight: 0.9, opacity: 0.35 }}>TSLA</span>
            <span style={{ fontSize: 36, color: C.down, marginLeft: 14 }}>-0.85%</span>
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 44,
              right: 120,
              fontFamily: f.stencilFace,
              fontSize: 58,
              color: C.cooked,
              border: `6px solid ${C.cooked}`,
              padding: "0 12px",
              transform: "rotate(-12deg)",
            }}
          >
            COOKED
          </div>
          <div style={{ display: "flex", fontSize: 30, color: C.dim, marginTop: 18, textTransform: "lowercase" }}>
            {BRAND.domain}
          </div>
        </div>
      </div>
    ),
    { width: 1500, height: 500, fonts: f.list.length ? f.list : undefined },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (asset === "pfp.png") return pfp();
  if (asset === "banner.png") return banner();
  return new Response("Not found", { status: 404 });
}
