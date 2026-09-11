/* The site's own share card: the brand and the promise over the ticker wall
 * the X banner uses, so a pasted link and the profile look like one thing. */

import { ImageResponse } from "next/og";

import { BRAND } from "@/lib/brand";
import { loadGoogleFont } from "@/lib/ogFont";
import { markSvg, PALETTE as C } from "@/lib/palette";
import { ROSTER } from "@/lib/stocks";

export const alt = "Stonk Wars: your stock vs theirs. Loser gets cooked.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const tickers = ROSTER.map((s) => s.ticker).join(" ");
  const raw = `STONKWARS YOUR STOCK VS THEIRS. LOSER GETS COOKED. ${BRAND.domain} STAKE REAL SHARES · STOCKS · SOLANA ${tickers} +-.%0123456789`;
  const display = await loadGoogleFont("Big Shoulders", 900, `${raw}${raw.toLowerCase()}`);
  const face = display ? "Display" : "sans-serif";
  const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg(3.4)).toString("base64")}`;

  let seed = 7;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const rows = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 7 }, (_, i) => ({ ticker: ROSTER[(r * 4 + i * 3) % ROSTER.length].ticker, move: (rand() - 0.46) * 7 })),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: C.void,
          color: C.ink,
          fontFamily: face,
          textTransform: "uppercase",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: -4, left: -40, display: "flex", flexDirection: "column" }}>
          {rows.map((row, r) => (
            <div key={r} style={{ display: "flex", marginLeft: r % 2 ? 85 : 0, height: 71, alignItems: "center" }}>
              {row.map((cell, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", width: 185 }}>
                  <span style={{ fontSize: 38, opacity: 0.12 }}>{cell.ticker}</span>
                  <span style={{ fontSize: 22, marginLeft: 8, opacity: 0.3, color: cell.move >= 0 ? C.up : C.down }}>
                    {`${cell.move >= 0 ? "+" : "-"}${Math.abs(cell.move).toFixed(2)}%`}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            backgroundImage: `radial-gradient(ellipse 500px 300px at 600px 315px, ${C.void} 55%, rgba(11,11,12,0.85) 72%, rgba(11,11,12,0) 100%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={mark} width={104} height={104} />
            <div style={{ display: "flex", fontSize: 140, lineHeight: 1, marginLeft: 20 }}>
              <span>STONK</span>
              <span style={{ color: C.p2 }}>WARS</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 56, lineHeight: 1.05, marginTop: 16 }}>
            <span>Your stock vs theirs.</span>
            <span style={{ color: C.cooked }}>Loser gets cooked.</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: C.dim, marginTop: 20 }}>
            {`Stake real shares · ${ROSTER.length} stocks · ${BRAND.domain}`}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: display ? [{ name: "Display", data: display, weight: 900, style: "normal" }] : undefined },
  );
}
