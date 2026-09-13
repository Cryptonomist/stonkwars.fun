/* The card a fight link unfurls into on X. Drawn from chain state at request
 * time: an open challenge is a VS card with the stakes and the taunt; a live
 * round shows the score; a settled one stamps the loser COOKED. */

import { ImageResponse } from "next/og";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  decodeDuel,
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  PROGRAM_ID,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  type DuelView,
} from "@/lib/duel";
import { BRAND } from "@/lib/brand";
import { pct, shares } from "@/lib/format";
import { loadGoogleFont } from "@/lib/ogFont";
import { PALETTE } from "@/lib/palette";
import { movePct } from "@/lib/pricemath";
import { STAKE_DECIMALS, tickerForMint } from "@/lib/stocks";

export const runtime = "nodejs";
export const alt = "A Stonk Wars fight";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 30;

const C = PALETTE;

async function readDuel(address: string): Promise<DuelView | null> {
  try {
    const key = new PublicKey(address);
    const conn = new Connection(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com");
    const info = await Promise.race([conn.getAccountInfo(key), new Promise<null>((r) => setTimeout(() => r(null), 3_000))]);
    if (!info || !info.owner.equals(PROGRAM_ID)) return null;
    return decodeDuel(key, info.data);
  } catch {
    return null;
  }
}

/* The card is the only version of a result most people ever see, so a weekend
 * move must not round away to nothing on it. pct widens past two decimals only
 * when two would print a real move as zero. */
const pctText = (n: number) => pct(n);

export default async function Image({ params }: { params: Promise<{ duel: string }> }) {
  const { duel } = await params;
  const d = await readDuel(duel);

  const t1 = d ? tickerForMint(d.creatorMint) ?? "?" : "???";
  const t2 = d ? tickerForMint(d.opponentMint) ?? "?" : "???";
  const settled = d && (d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE));
  const m1 = d && settled ? movePct(d.creatorStart, d.creatorEnd) : null;
  const m2 = d && settled ? movePct(d.opponentStart, d.opponentEnd) : null;
  const p1Cooked = d?.status === STATUS_SETTLED && d.outcome === OUTCOME_OPPONENT;
  const p2Cooked = d?.status === STATUS_SETTLED && d.outcome === OUTCOME_CREATOR;

  const status = !d
    ? "Fight"
    : d.status === STATUS_OPEN
      ? "Open challenge · take the other side"
      : d.status === STATUS_ACCEPTED || d.status === STATUS_LIVE
        ? "Round live"
        : d.status === STATUS_SETTLED
          ? "Final · settled on Solana"
          : d.outcome === OUTCOME_TIE
            ? "Dead heat"
            : "Void";

  const taunt = d?.taunt ? `“${d.taunt}”` : "";
  // The card uppercases most of its text, so the subset needs both cases.
  const raw = `${BRAND.short}${BRAND.domain}${t1}${t2}VS COOKED staked${status}${taunt}0123456789.+-%$ ·`;
  const text = `${raw}${raw.toUpperCase()}${raw.toLowerCase()}`;
  const [display, stencil] = await Promise.all([
    loadGoogleFont("Big Shoulders", 900, text),
    loadGoogleFont("Big Shoulders Stencil", 900, "COOKED"),
  ]);
  const fonts = [
    ...(display ? [{ name: "Display", data: display, weight: 900 as const, style: "normal" as const }] : []),
    ...(stencil ? [{ name: "Stencil", data: stencil, weight: 900 as const, style: "normal" as const }] : []),
  ];
  const face = display ? "Display" : "sans-serif";

  const corner = (side: "p1" | "p2") => {
    const ticker = side === "p1" ? t1 : t2;
    const move = side === "p1" ? m1 : m2;
    const cooked = side === "p1" ? p1Cooked : p2Cooked;
    const amount = d ? (side === "p1" ? d.creatorAmount : d.opponentAmount) : BigInt(0);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: side === "p1" ? "flex-start" : "flex-end",
          width: 470,
          position: "relative",
        }}
      >
        <div style={{ fontSize: 190, lineHeight: 0.9, color: side === "p1" ? C.p1 : C.p2, opacity: cooked ? 0.35 : 1 }}>
          {ticker}
        </div>
        {move !== null ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: side === "p1" ? "flex-start" : "flex-end" }}>
            <div style={{ fontSize: 64, color: move > 0 ? C.up : move < 0 ? C.down : C.dim }}>{pctText(move)}</div>
            {/* Both stocks can fall; the winner is whoever fell less, so say it. */}
            {d?.status === STATUS_SETTLED && !cooked ? (
              <div style={{ fontSize: 34, color: C.up, marginTop: 4 }}>Takes both stakes</div>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 40, color: C.dim, textTransform: "none" }}>
            {d ? `${shares(amount, STAKE_DECIMALS)} ${ticker}x staked` : ""}
          </div>
        )}
        {cooked ? (
          <div
            style={{
              position: "absolute",
              top: 40,
              [side === "p1" ? "left" : "right"]: -10,
              fontFamily: stencil ? "Stencil" : face,
              fontSize: 110,
              color: C.cooked,
              border: `8px solid ${C.cooked}`,
              padding: "0 18px",
              transform: "rotate(-12deg)",
            }}
          >
            COOKED
          </div>
        ) : null}
      </div>
    );
  };

  /* Rendered to bytes here rather than streamed, so a failure is caught, logged
   * and answered with the site card instead of an empty 500 that X caches. */
  try {
    const res = new ImageResponse(card(), { ...size, fonts: fonts.length ? fonts : undefined });
    const png = await res.arrayBuffer();
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=30" } });
  } catch (e) {
    console.error("share card failed", e);
    return new Response(String(e instanceof Error ? e.stack : e), { status: 500 });
  }

  function card() {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.void,
          backgroundImage: `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          color: C.ink,
          fontFamily: face,
          padding: "44px 56px",
          textTransform: "uppercase",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 34 }}>
          <div style={{ display: "flex" }}>
            <span>STONK</span>
            <span style={{ color: C.p2 }}>WARS</span>
          </div>
          <div style={{ color: C.dim, fontSize: 30 }}>{status}</div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between" }}>
          {corner("p1")}
          <div style={{ fontSize: 110, color: C.ink }}>VS</div>
          {corner("p2")}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 36, color: C.ink, textTransform: "none", maxWidth: 860 }}>{taunt}</div>
          <div style={{ fontSize: 30, color: C.dim, textTransform: "lowercase" }}>{BRAND.domain}</div>
        </div>
      </div>
    );
  }
}
