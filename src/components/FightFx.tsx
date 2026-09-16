"use client";

/* The fight, felt.
 *
 * A round is two stocks drifting apart by hundredths of a point, which is not
 * something anybody watches. So every price that arrives is drawn as a hit:
 * the fighter who gained lands it, the other's health drops, the damage flies
 * off them, and a run of them is a combo. At the bell, a knockout.
 *
 * It is theatre over real numbers, never instead of them: the damage is the
 * actual change in the gap, and the result on chain is decided by the program
 * from two signed prices. */

import { useEffect, useRef, useState } from "react";

import { comboOf, gapOf, hitFrom, liveHits, HEAVY_POINTS, type Hit, type Side } from "@/lib/fightFeel";
import { points } from "@/lib/format";

export function useFightFeel(p1Move: number | null, p2Move: number | null, live: boolean) {
  const [hits, setHits] = useState<Hit[]>([]);
  const previous = useRef<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!live || p1Move === null || p2Move === null) {
      previous.current = null;
      return;
    }
    const gap = gapOf(p1Move, p2Move);
    const before = previous.current;
    previous.current = gap;
    if (before === null) return;
    const hit = hitFrom(before, gap, Date.now(), (seq.current += 1));
    if (hit) setHits((h) => [...liveHits(h, Date.now()), hit]);
  }, [p1Move, p2Move, live]);

  // Let old hits fall out, so a combo ends when the punches stop.
  useEffect(() => {
    if (!hits.length) return;
    const t = setTimeout(() => setHits((h) => liveHits(h, Date.now())), 2_000);
    return () => clearTimeout(t);
  }, [hits]);

  const now = Date.now();
  const last = hits[hits.length - 1];
  return {
    hits,
    combo: comboOf(hits, now),
    /** The most recent hit, while it is still worth drawing. */
    landing: last && now - last.at < 1_200 ? last : null,
    heavy: !!last && now - last.at < 400 && last.damage >= HEAVY_POINTS,
  };
}

/* True once a fight settles while this page is open, and never for one that
 * was already over when the visitor arrived. A knockout has to be witnessed. */
export function useKnockout(settled: boolean) {
  const before = useRef<boolean | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (before.current === null) {
      before.current = settled;
      return;
    }
    if (settled && !before.current) setShow(true);
    before.current = settled;
  }, [settled]);
  return show;
}

/** The damage flying off whoever was hit. Red, because a hit is a move in the
 *  gap between the two stocks, against this side. */
export function Damage({ hits, side }: { hits: Hit[]; side: Side }) {
  const mine = hits.filter((h) => h.side !== side).slice(-3);
  return (
    <span className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center" aria-hidden="true">
      {mine.map((h) => (
        <span key={h.id} className="damage num absolute text-hud-sm font-bold text-down">
          −{points(h.damage)}
        </span>
      ))}
    </span>
  );
}

/** A run of hits by one side, in that side's colour: the combo is a side's. */
export function Combo({ combo }: { combo: { side: Side; count: number; damage: number } | null }) {
  if (!combo) return null;
  return (
    <span
      key={`${combo.side}-${combo.count}`}
      className={`combo display text-hud-sm ${combo.side === "p1" ? "text-p1" : "text-p2"}`}
    >
      {combo.count}-hit combo
      <span className="num ml-2 text-meta text-dim normal-case">{points(combo.damage)} pts</span>
    </span>
  );
}

/* The knockout: slammed on when a fight settles while someone is watching.
 * K.O. is ink with the chromatic split .ko draws in both corners' colours. It
 * used to be orange, and orange is the COOKED stamp and nothing else. A draw is
 * ink too: nobody was knocked out. */
export function Knockout({ show, tie }: { show: boolean; tie: boolean }) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setSeen(true), 2_600);
    return () => clearTimeout(t);
  }, [show]);
  if (!show || seen) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-void/60" aria-hidden="true">
      <span className="ko display text-hud-ko-phone text-ink sm:text-hud-ko">{tie ? "Draw" : "K.O."}</span>
    </div>
  );
}
