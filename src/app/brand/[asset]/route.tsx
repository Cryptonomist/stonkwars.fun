/* Brand assets, drawn from the same code as the share cards so the type and
 * colours can never drift from the site:
 *
 *   /brand/pfp.png     400x400, the mark, for the X profile (cropped to a circle)
 *   /brand/banner.png  1500x500, the X header: a wall of tickers with the
 *                      wordmark in the middle, clear of the bottom-left corner
 *                      the profile picture covers on desktop
 */

import { ImageResponse } from "next/og";

import { BRAND } from "@/lib/brand";
import { loadGoogleFont } from "@/lib/ogFont";
import { markSvg, PALETTE as C } from "@/lib/palette";
import { ROSTER } from "@/lib/stocks";

const markUri = (stroke = 3.2) => `data:image/svg+xml;base64,${Buffer.from(markSvg(stroke)).toString("base64")}`;

async function fonts(text: string) {
  const all = `${text}${text.toUpperCase()}${text.toLowerCase()}`;
  const display = await loadGoogleFont("Big Shoulders", 900, all);
  return {
    face: display ? "Display" : "sans-serif",
    list: display ? [{ name: "Display", data: display, weight: 900 as const, style: "normal" as const }] : [],
  };
}

/* Deterministic moves for the wall, so the banner is the same every render. */
function wall(rows: number, perRow: number) {
  let seed = 20260911;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: perRow }, (_, i) => {
      const stock = ROSTER[(r * 5 + i * 3) % ROSTER.length];
      const move = (rand() - 0.46) * 7;
      return { ticker: stock.ticker, move };
    }),
  );
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
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={markUri(3.6)} width={280} height={280} />
      </div>
    ),
    { width: 400, height: 400 },
  );
}

async function banner() {
  const rows = wall(7, 9);
  const tickerText = ROSTER.map((s) => s.ticker).join(" ");
  const f = await fonts(
    `STONKWARS YOUR STOCK VS THEIRS. LOSER GETS COOKED. ${BRAND.domain} STAKE REAL SHARES · PYTH DECIDES · SOLANA ${tickerText} +-.%0123456789`,
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
          fontFamily: f.face,
          color: C.ink,
          textTransform: "uppercase",
          overflow: "hidden",
        }}
      >
        {/* The wall: every stock in the roster, moving. */}
        <div style={{ position: "absolute", top: -6, left: -60, display: "flex", flexDirection: "column" }}>
          {rows.map((row, r) => (
            <div key={r} style={{ display: "flex", marginLeft: r % 2 ? 90 : 0, height: 73, alignItems: "center" }}>
              {row.map((cell, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", width: 190 }}>
                  <span style={{ fontSize: 40, color: C.ink, opacity: 0.13 }}>{cell.ticker}</span>
                  <span
                    style={{
                      fontSize: 24,
                      marginLeft: 8,
                      color: cell.move >= 0 ? C.up : C.down,
                      opacity: 0.32,
                    }}
                  >
                    {`${cell.move >= 0 ? "+" : "-"}${Math.abs(cell.move).toFixed(2)}%`}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* A pool of dark behind the wordmark, so the wall never fights it. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1500,
            height: 500,
            backgroundImage: `radial-gradient(ellipse 560px 250px at 750px 250px, ${C.void} 55%, rgba(11,11,12,0.85) 72%, rgba(11,11,12,0) 100%)`,
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1500,
            height: 500,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={markUri(3.4)} width={112} height={112} />
            <div style={{ display: "flex", fontSize: 150, lineHeight: 1, marginLeft: 22 }}>
              <span>STONK</span>
              <span style={{ color: C.p2 }}>WARS</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 46, marginTop: 10 }}>
            <span>Your stock vs theirs.</span>
            <span style={{ color: C.cooked, marginLeft: 14 }}>Loser gets cooked.</span>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: C.dim, marginTop: 14 }}>
            {`Stake real shares · Pyth decides · Solana · ${BRAND.domain}`}
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
