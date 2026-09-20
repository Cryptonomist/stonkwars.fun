/* The card a fight link unfurls into on X. Drawn from chain state at request
 * time: an open challenge is a VS card with the stakes and the taunt; a live
 * round shows its stakes; a settled one is the K.O.
 *
 * THE K.O. CARD says what happened, the way the fight page does. The winner's
 * ticker stands in its side's colour with "TOOK 0.0100 METAx" in green under
 * it, the money the program moved. The loser's ticker is at half strength and
 * the COOKED stamp lands on its move, not over its name, so the card still
 * says who lost. Both moves are shown, green or red by the way each went: both
 * stocks can fall, and the winner is whoever fell less.
 *
 * A CARD ALWAYS COMES BACK. X caches whatever the first request returns, so a
 * failure here answers with the site's own card, status 200, and never with a
 * stack trace. */

import { ImageResponse } from "next/og";
import { Connection, PublicKey } from "@solana/web3.js";

import SiteCard from "@/app/opengraph-image";
import { BRAND } from "@/lib/brand";
import { loserTake } from "@/lib/derive";
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
import { pct, pctPair, points, shares, usd } from "@/lib/format";
import { loadGoogleFont } from "@/lib/ogFont";
import { PALETTE } from "@/lib/palette";
import { movePct } from "@/lib/pricemath";
import { decimalsForMint, isListedDuel, tickerForMint, tokenSymbol } from "@/lib/stocks";

export const runtime = "nodejs";
export const alt = "A Stonk Wars fight";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 30;

const C = PALETTE;
const RETIRED = "Retired test fight";
const HEADERS = { "content-type": "image/png", "cache-control": "public, max-age=30" };

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

/* The fallback: the site's card, rendered to bytes so a failure in it is
 * caught too, and past that a plain brand card with no font to fetch. */
async function fallback(): Promise<Response> {
  try {
    const png = await (await SiteCard()).arrayBuffer();
    return new Response(png, { status: 200, headers: HEADERS });
  } catch {
    const png = await new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: C.void,
            color: C.ink,
            fontSize: 120,
            fontWeight: 900,
          }}
        >
          <span>STONK</span>
          <span style={{ color: C.p2, marginLeft: 24 }}>WARS</span>
        </div>
      ),
      size,
    ).arrayBuffer();
    return new Response(png, { status: 200, headers: HEADERS });
  }
}

export default async function Image({ params }: { params: Promise<{ duel: string }> }) {
  try {
    const { duel } = await params;
    const d = await readDuel(duel);
    const png = await (await render(d)).arrayBuffer();
    return new Response(png, { status: 200, headers: HEADERS });
  } catch (e) {
    console.error("share card failed", e instanceof Error ? e.message : e);
    return fallback();
  }
}

async function render(d: DuelView | null): Promise<ImageResponse> {
  const t1 = d ? (tickerForMint(d.creatorMint) ?? "?") : "???";
  const t2 = d ? (tickerForMint(d.opponentMint) ?? "?") : "???";
  /* An old test fight on a mint that is not a listed stock has no tickers to
   * put in the corners, only "?". The card says what it is instead. */
  const retired = !!d && !isListedDuel(d);
  const settled = !!d && d.status === STATUS_SETTLED;
  const heat = !!d && d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE;
  const final = settled || heat;
  const m1 = d && final ? movePct(d.creatorStart, d.creatorEnd) : null;
  const m2 = d && final ? movePct(d.opponentStart, d.opponentEnd) : null;
  // Two close moves widen together, so a loss never reads as a tie on the card.
  const pair: [string | null, string | null] = m1 !== null && m2 !== null ? pctPair(m1, m2) : [null, null];
  const p1Cooked = settled && d!.outcome === OUTCOME_OPPONENT;
  const p2Cooked = settled && d!.outcome === OUTCOME_CREATOR;
  const take = d && settled ? loserTake(d) : null;
  const tookLine = take
    ? `TOOK ${shares(take.shares, take.decimals)} ${tokenSymbol(take.ticker)}${take.usd ? ` · ${usd(take.usd)}` : ""}`
    : "";
  const margin = m1 !== null && m2 !== null && settled ? `Won by ${points(Math.abs(m1 - m2))} pts` : "";

  const status = !d
    ? "Fight"
    : d.status === STATUS_OPEN
      ? "Open challenge · take the other side"
      : d.status === STATUS_ACCEPTED
        ? "Fight on · starts at the next price"
        : d.status === STATUS_LIVE
          ? "Round live"
          : settled
            ? "Final · settled on Solana"
            : heat
              ? "Dead heat · both stakes home"
              : "Void";

  const taunt = d?.taunt ? `“${d.taunt}”` : "";
  const stakes = d
    ? `${shares(d.creatorAmount, decimalsForMint(d.creatorMint))} ${tokenSymbol(t1)} ${shares(d.opponentAmount, decimalsForMint(d.opponentMint))} ${tokenSymbol(t2)}`
    : "";
  /* Every fixed label goes in the subset, not just the ones this fight shows.
   * Otherwise a letter a label needs is only loaded when some dynamic string
   * happens to carry it, and an empty taunt draws the B of a label in the
   * fallback face. */
  const labels =
    "Stonk Wars VS COOKED x staked to take it TOOK Won by pts Fight Open challenge · take the other side " +
    "Fight on · starts at the next price Round live Final · settled on Solana Dead heat · both stakes home Void Cooked";
  // The card uppercases most of its text, so the subset needs both cases.
  const raw = `${BRAND.short}${BRAND.domain}${t1}${t2}${labels}${RETIRED}${status}${taunt}${stakes}${tookLine}${margin}0123456789.+-%$ ·`;
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

  const moveColour = (m: number) => (m > 0 ? C.up : m < 0 ? C.down : C.dim);

  const corner = (side: "p1" | "p2") => {
    const left = side === "p1";
    const ticker = left ? t1 : t2;
    const move = left ? m1 : m2;
    const cooked = left ? p1Cooked : p2Cooked;
    const won = settled && !cooked && !heat;
    const amount = d ? (left ? d.creatorAmount : d.opponentAmount) : BigInt(0);
    const mint = d ? (left ? d.creatorMint : d.opponentMint) : null;
    const align = left ? "flex-start" : "flex-end";
    /* Fixed widths that add up inside the card: two corners of 430 and a centre
     * of 200 in the 1088 between the paddings. A five-letter ticker steps down
     * so it stays inside its corner. */
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: align, width: 430, flexShrink: 0 }}>
        <div style={{ fontSize: ticker.length >= 5 ? 150 : 180, lineHeight: 0.9, color: left ? C.p1 : C.p2, opacity: cooked ? 0.5 : 1 }}>
          {ticker}
        </div>
        {move !== null ? (
          /* The move block. The loser's stamp lands here, under the move and
           * clear of the ticker, so both still read. */
          <div style={{ display: "flex", flexDirection: "column", alignItems: align, marginTop: 8 }}>
            <div style={{ fontSize: 64, color: moveColour(move) }}>{(left ? pair[0] : pair[1]) ?? pct(move)}</div>
            {won && tookLine ? (
              <div style={{ fontSize: 40, color: C.up, marginTop: 6, textTransform: "none" }}>{tookLine}</div>
            ) : null}
            {cooked ? (
              <div
                style={{
                  marginTop: 14,
                  fontFamily: stencil ? "Stencil" : face,
                  fontSize: 64,
                  lineHeight: 1,
                  color: C.cooked,
                  border: `6px solid ${C.cooked}`,
                  padding: "4px 16px 0",
                  transform: "rotate(-8deg)",
                }}
              >
                COOKED
              </div>
            ) : null}
          </div>
        ) : (
          /* Nobody has staked the open seat yet: its line is what taking it
           * costs, so the card never shows a stake that is not in escrow. */
          <div style={{ fontSize: 40, color: C.dim, textTransform: "none" }}>
            {d && mint
              ? `${shares(amount, decimalsForMint(mint))} ${tokenSymbol(ticker)} ${!left && d.status === STATUS_OPEN ? "to take it" : "staked"}`
              : ""}
          </div>
        )}
      </div>
    );
  };

  return new ImageResponse(
    (
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

        {retired ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 120, color: C.dim }}>{RETIRED}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between" }}>
            {corner("p1")}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 200, flexShrink: 0 }}>
              <div style={{ fontSize: 110, color: C.ink }}>VS</div>
              {margin ? <div style={{ fontSize: 24, color: C.dim, textTransform: "none" }}>{margin}</div> : null}
            </div>
            {corner("p2")}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 36, color: C.ink, textTransform: "none", maxWidth: 860 }}>{taunt}</div>
          <div style={{ fontSize: 30, color: C.dim, textTransform: "lowercase" }}>{BRAND.domain}</div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
