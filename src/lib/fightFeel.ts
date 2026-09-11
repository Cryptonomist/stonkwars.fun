/* A round, as a fight.
 *
 * The only number that matters in a fight is the gap between the two stocks'
 * moves. Every time a new price arrives the gap shifts, and that shift is a
 * hit: whoever gained lands it, and its size is the damage. Hits by the same
 * fighter, close together, are a combo.
 *
 * This is the HUD's arithmetic, kept apart from the drawing so it can be
 * tested. None of it reaches the chain: the program decides on exact integers
 * from the two boundary prices, and nothing here is an input to that. */

export type Side = "p1" | "p2";

export type Hit = {
  id: number;
  side: Side;
  /** Percentage points the gap moved. */
  damage: number;
  /** Milliseconds since the epoch. */
  at: number;
};

/** Below this, a price tick is noise, not a punch. */
export const HIT_POINTS = 0.01;

/** A hit this big shakes the screen. */
export const HEAVY_POINTS = 0.06;

/** Hits by one fighter inside this window count as one combo. */
export const COMBO_MS = 14_000;

/** Two hits in a row is not a combo; three is. */
export const COMBO_MIN = 3;

/** The gap between the fighters, in points. Positive favours the challenger. */
export const gapOf = (p1Move: number, p2Move: number) => p1Move - p2Move;

/** What changed between two gaps: a hit, or nothing worth drawing. */
export function hitFrom(before: number, after: number, at: number, id: number): Hit | null {
  const delta = after - before;
  if (!Number.isFinite(delta) || Math.abs(delta) < HIT_POINTS) return null;
  return { id, side: delta > 0 ? "p1" : "p2", damage: Math.abs(delta), at };
}

/** The run of hits one fighter has landed, if it is long enough to name. */
export function comboOf(hits: Hit[], now: number): { side: Side; count: number; damage: number } | null {
  const recent = hits.filter((h) => now - h.at <= COMBO_MS);
  if (!recent.length) return null;
  const side = recent[recent.length - 1].side;
  const run: Hit[] = [];
  for (let i = recent.length - 1; i >= 0 && recent[i].side === side; i--) run.unshift(recent[i]);
  if (run.length < COMBO_MIN) return null;
  return { side, count: run.length, damage: run.reduce((sum, h) => sum + h.damage, 0) };
}

/** Hits worth keeping in memory: the last few, still inside the window. */
export const liveHits = (hits: Hit[], now: number, keep = 6) =>
  hits.filter((h) => now - h.at <= COMBO_MS).slice(-keep);
