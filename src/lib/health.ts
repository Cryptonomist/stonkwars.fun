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
