/* WHAT A RESULT SAYS WHEN IT IS POSTED.
 *
 * The post is how a win reaches anybody who was not there, so it carries the
 * three things a stranger on X reacts to: a name, a number, and somebody
 * tagged. It used to read the same whoever shared it, left out the dollars,
 * and never named the loser, who is the one most likely to answer.
 *
 * It reads differently for the winner, the loser and a spectator, because those
 * are three different posts. A handle is used only where the wallet has linked
 * one on chain; nobody is tagged by guesswork, and an unlinked fighter is
 * simply not named.
 *
 * pct() rather than toFixed(2) for the moves: "NVDA -0.00%" in public reads as
 * a broken site rather than a quiet weekend. */

import { pct, points } from "./format";

export type KoPost = {
  win: string;
  lose: string;
  /** Percent moves, winner's and loser's. */
  mw: number;
  ml: number;
  /** Both sides priced by Pyth, so the post can say so. */
  byPyth: boolean;
  winnerHandle?: string | null;
  loserHandle?: string | null;
  /** What the loser's stake was worth at the bell, when known. */
  tookUsd?: string | null;
  viewer: "winner" | "loser" | "other";
};

const at = (h?: string | null) => (h ? `@${h.replace(/^@/, "")}` : null);

export function koPostText(p: KoPost): string {
  const winner = at(p.winnerHandle);
  const loser = at(p.loserHandle);
  const moves = `${p.win} ${pct(p.mw)} vs ${p.lose} ${pct(p.ml)}`;
  const settled = `settled ${p.byPyth ? "by Pyth " : ""}on Solana`;
  const took = p.tookUsd ? ` Took ${p.tookUsd} of ${p.lose}.` : "";

  if (p.viewer === "winner") {
    return `Cooked ${loser ?? p.lose}. ${moves}, ${settled}.${took} Run it back?`;
  }
  if (p.viewer === "loser") {
    const gap = points(Math.abs(p.mw - p.ml));
    return `${winner ?? p.win} cooked me by ${gap} points. ${moves}, ${settled}. Rematch is open:`;
  }
  const who = winner ? ` ${winner} took both stakes${p.tookUsd ? `, ${p.tookUsd}` : ""}.` : took;
  return `${p.lose} got cooked. ${moves}, ${settled}.${who}${loser ? ` ${loser}, your move.` : ""}`;
}

/** An open challenge addressed to one wallet tags that wallet's handle. */
export function calloutPrefix(inviteeHandle?: string | null): string {
  const h = at(inviteeHandle);
  return h ? `${h} you are called out. ` : "";
}
