/* The card a profile link unfurls into: the wallet's face, its name, its
 * record, what it has taken and its last ten results, drawn from chain state
 * at request time.
 *
 * It reads only this wallet's fights (two filtered reads, as creator and as
 * answerer) and keeps the same stock fights every board counts, so the card
 * agrees with the profile and the leaderboard. Each read has a deadline.
 *
 * A share card that fails must still be a card. X caches whatever it gets, so
 * a 500 or a stack trace here would stick to the link for days; any failure,
 * from a bad address to a dead RPC node to a font that did not load, answers
 * with the site's own card instead. */

import { ImageResponse } from "next/og";
import { PublicKey, type Connection } from "@solana/web3.js";

import SiteImage from "@/app/opengraph-image";
import { identiconCells } from "@/components/ui/Identicon";
import { BRAND } from "@/lib/brand";
import { decodeDuel, duelsAcceptedBy, duelsCreatedBy, PROGRAM_ID, type DuelView } from "@/lib/duel";
import { isRosterFight, recordFor, type Result } from "@/lib/derive";
import { shortAddress, usd } from "@/lib/format";
import { loadGoogleFont } from "@/lib/ogFont";
import { PALETTE as C } from "@/lib/palette";

import { readVouchedHandle, serverConnection, withDeadline } from "./readHandle";

export const runtime = "nodejs";
export const alt = "A Stonk Wars fighter's record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 60;

const DEADLINE_MS = 3_000;

class Unreachable extends Error {}

async function readFights(conn: Connection, key: PublicKey): Promise<DuelView[]> {
  const read = (filters: ReturnType<typeof duelsCreatedBy>) =>
    withDeadline(
      conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters }).catch(() => null),
      DEADLINE_MS,
      null,
    );
  const [made, took] = await Promise.all([read(duelsCreatedBy(key)), read(duelsAcceptedBy(key))]);
  /* Half an answer would draw a record that is wrong, so a missing half is a
   * failure and the site card goes out instead. */
  if (!made || !took) throw new Unreachable("RPC did not answer in time");
  const seen = new Map<string, DuelView>();
  for (const a of [...made, ...took]) {
    try {
      const d = decodeDuel(a.pubkey, a.account.data);
      if (isRosterFight(d)) seen.set(a.pubkey.toBase58(), d);
    } catch {
      /* Not a duel this build can read. */
    }
  }
  return [...seen.values()];
}

async function png(res: ImageResponse): Promise<Response> {
  const bytes = await res.arrayBuffer();
  return new Response(bytes, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=60" },
  });
}

export default async function Image({ params }: { params: Promise<{ wallet: string }> }) {
  try {
    const { wallet } = await params;
    const key = new PublicKey(wallet);
    const conn = serverConnection();
    const [handle, fights] = await Promise.all([readVouchedHandle(conn, key, DEADLINE_MS), readFights(conn, key)]);
    return await png(await card(key.toBase58(), handle, fights));
  } catch (e) {
    if (!(e instanceof Unreachable)) console.error("profile card failed", e instanceof Error ? e.message : e);
    return siteCard();
  }
}

async function siteCard(): Promise<Response> {
  try {
    return await png(await SiteImage());
  } catch {
    /* The site card needs a font from Google too. Past that, a plain brand
     * card in the built-in face, which needs nothing from anywhere. */
    return png(
      new ImageResponse(
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
            <span style={{ color: C.p2 }}>WARS</span>
          </div>
        ),
        size,
      ),
    );
  }
}

async function card(wallet: string, handle: string | null, fights: DuelView[]): Promise<ImageResponse> {
  const r = recordFor(wallet, fights);
  const name = handle ? `@${handle}` : shortAddress(wallet);
  const took = r.taken >= 0.005;
  const record = `${r.wins}W ${r.losses}L${r.ties ? ` ${r.ties}T` : ""}`;
  const takenText = usd(r.taken);

  const labels = "Stonk Wars Fighter record Taken Last 10 No fights on chain yet No results yet";
  const displayText = `${BRAND.short}${labels}${record}${handle ?? ""}`;
  const monoText = `${shortAddress(wallet)}${takenText}${BRAND.domain}0123456789`;
  const [display, mono] = await Promise.all([
    loadGoogleFont("Big Shoulders", 900, `${displayText}${displayText.toUpperCase()}${displayText.toLowerCase()}`),
    loadGoogleFont("Geist Mono", 600, `${monoText}${monoText.toUpperCase()}${monoText.toLowerCase()}`),
  ]);
  const fonts = [
    ...(display ? [{ name: "Display", data: display, weight: 900 as const, style: "normal" as const }] : []),
    ...(mono ? [{ name: "Mono", data: mono, weight: 600 as const, style: "normal" as const }] : []),
  ];
  const face = display ? "Display" : "sans-serif";
  const monoFace = mono ? "Mono" : "monospace";

  const cells = identiconCells(wallet);
  const CELL = 52;
  const pips: Result[] = r.form;

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
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 34 }}>
          <div style={{ display: "flex", textTransform: "uppercase" }}>
            <span>STONK</span>
            <span style={{ color: C.p2 }}>WARS</span>
          </div>
          <div style={{ color: C.dim, fontSize: 30, textTransform: "uppercase" }}>Fighter record</div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          {/* The face: ink cells on a panel, as on the site. */}
          <div style={{ display: "flex", padding: 24, background: C.panel, border: `2px solid ${C.line}`, flexShrink: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", width: CELL * 5, height: CELL * 5 }}>
              {cells.map((on, i) => (
                <div key={i} style={{ width: CELL, height: CELL, background: on ? C.ink : "transparent", opacity: 0.9 }} />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginLeft: 56, minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontFamily: handle ? face : monoFace,
                fontSize: handle ? 96 : 64,
                lineHeight: 1,
                color: handle ? C.ink : C.dim,
              }}
            >
              {name}
            </div>

            {r.fights > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "baseline", marginTop: 28, fontSize: 132, lineHeight: 0.9 }}>
                  <span>{`${r.wins}W`}</span>
                  <span style={{ color: C.dim, marginLeft: 28 }}>{`${r.losses}L`}</span>
                  {r.ties ? <span style={{ color: C.dim, marginLeft: 28 }}>{`${r.ties}T`}</span> : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", marginTop: 32 }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 28, color: C.dim, textTransform: "uppercase" }}>Taken</span>
                    <span style={{ fontFamily: monoFace, fontSize: 56, color: took ? C.up : C.dim }}>{takenText}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", marginLeft: 64 }}>
                    <span style={{ fontSize: 28, color: C.dim, textTransform: "uppercase" }}>Last 10</span>
                    <div style={{ display: "flex", marginTop: 18 }}>
                      {pips.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            width: 30,
                            height: 30,
                            marginRight: 8,
                            display: "flex",
                            alignItems: "center",
                            background: p === "W" ? C.up : "transparent",
                            border: p === "L" ? `3px solid ${C.dim}` : "none",
                          }}
                        >
                          {p === "T" ? <div style={{ width: 30, height: 6, background: C.dim }} /> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", marginTop: 28, fontSize: 64, color: C.dim, textTransform: "uppercase" }}>
                {fights.length ? "No results yet" : "No fights on chain yet"}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", fontFamily: monoFace, fontSize: 28, color: C.dim }}>
          {BRAND.domain}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
