/* The site's own share card: the brand, the promise, and a sample result. */

import { ImageResponse } from "next/og";

import { BRAND } from "@/lib/brand";
import { loadGoogleFont } from "@/lib/ogFont";

export const alt = "Stonk Wars: your stock vs theirs. Loser gets cooked.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const raw = `STONKWARS YOUR STOCK VS THEIRS. LOSER GETS COOKED. NVDA TSLA +3.12% -0.85% ${BRAND.domain} Stake real shares. Pyth decides.`;
  const text = `${raw}${raw.toLowerCase()}`;
  const [display, stencil] = await Promise.all([
    loadGoogleFont("Big Shoulders", 900, text),
    loadGoogleFont("Big Shoulders Stencil", 900, "COOKED"),
  ]);
  const face = display ? "Display" : "sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#07070b",
          backgroundImage: "linear-gradient(#25253a55 1px, transparent 1px), linear-gradient(90deg, #25253a55 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          color: "#f3f3f8",
          fontFamily: face,
          padding: "56px 64px",
          textTransform: "uppercase",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", fontSize: 40 }}>
            <span>STONK</span>
            <span style={{ color: "#ffd84a" }}>WARS</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 108, lineHeight: 0.9 }}>
            <span>Your stock</span>
            <span>vs theirs.</span>
            <span style={{ color: "#ff7a1a", fontSize: 70, marginTop: 16 }}>Loser gets cooked.</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#9090a8", textTransform: "none" }}>
            Stake real shares. Pyth decides. {BRAND.domain}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", flex: 1, position: "relative" }}>
          <div style={{ fontSize: 150, color: "#2fe0ff", lineHeight: 0.9 }}>NVDA</div>
          <div style={{ fontSize: 56, color: "#35f28b" }}>+3.12%</div>
          <div style={{ fontSize: 70, color: "#ffd84a", margin: "10px 0" }}>VS</div>
          <div style={{ fontSize: 150, color: "#ff3ea5", lineHeight: 0.9, opacity: 0.35 }}>TSLA</div>
          <div style={{ fontSize: 56, color: "#ff4d5e" }}>-0.85%</div>
          <div
            style={{
              position: "absolute",
              bottom: 70,
              right: 40,
              fontFamily: stencil ? "Stencil" : face,
              fontSize: 96,
              color: "#ff7a1a",
              border: "8px solid #ff7a1a",
              padding: "0 16px",
              transform: "rotate(-12deg)",
            }}
          >
            COOKED
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        ...(display ? [{ name: "Display", data: display, weight: 900 as const, style: "normal" as const }] : []),
        ...(stencil ? [{ name: "Stencil", data: stencil, weight: 900 as const, style: "normal" as const }] : []),
      ],
    },
  );
}
