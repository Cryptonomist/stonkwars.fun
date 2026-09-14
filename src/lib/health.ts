/* The HUD's arithmetic, apart from the component so it can be tested.
 *
 * Both fighters start full. Whoever is behind loses health in proportion to
 * the gap between the two moves, so the bars show the only number that
 * decides the round: not how each stock did, but how far apart they are.
 *
 * The gap that empties a bar scales with the round. Two stocks rarely drift
 * more than a few tenths of a point apart in five minutes and routinely drift
 * several points in a week, so one fixed scale would leave short rounds
 * looking still and long ones permanently knocked out. Display only; the
 * program decides on exact integers, never on this. */

export function koGap(roundSecs: number): number {
  if (roundSecs <= 15 * 60) return 0.5;
  if (roundSecs <= 3_600) return 1;
  if (roundSecs <= 86_400) return 2;
  return 4;
}

export function healthFor(p1Move: number, p2Move: number, ko = 2): [number, number] {
  const gap = p1Move - p2Move;
  const hit = Math.min(100, (Math.abs(gap) / ko) * 100);
  if (gap > 0) return [100, 100 - hit];
  if (gap < 0) return [100 - hit, 100];
  return [100, 100];
}

/* THE BARS AT THE BELL. A settled fight used to draw both bars from the size of
 * the gap alone, and a gap of hundredths of a point left both nearly full: the
 * page said K.O. over two fighters still standing. The program has already
 * decided, so the bars say what it decided. The loser is empty. The winner
 * keeps what the gap left them, and never less than a sliver, so a winner by
 * a hair still reads as the one standing. A dead heat changes nothing: both
 * stakes went home, and nobody was knocked out.
 *
 * `outcome` is the program's own value (OUTCOME_CREATOR, OUTCOME_OPPONENT or
 * OUTCOME_TIE in duel.ts), so the bars cannot disagree with the result. */
export const OUTCOME_CREATOR_WON = 1;
export const OUTCOME_OPPONENT_WON = 2;

/** The least a winner's bar shows, so it is visibly the one left standing. */
export const WINNER_FLOOR = 10;

export function settledHealth(p1Move: number, p2Move: number, outcome: number, roundSecs: number): [number, number] {
  const [h1, h2] = healthFor(p1Move, p2Move, koGap(roundSecs));
  if (outcome === OUTCOME_CREATOR_WON) return [Math.max(h1, WINNER_FLOOR), 0];
  if (outcome === OUTCOME_OPPONENT_WON) return [0, Math.max(h2, WINNER_FLOOR)];
  return [h1, h2];
}
