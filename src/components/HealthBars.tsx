/* The HUD: two health bars, fighting-game style.
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

export function HealthBars({
  p1Move,
  p2Move,
  roundSecs = 86_400,
}: {
  p1Move: number | null;
  p2Move: number | null;
  roundSecs?: number;
}) {
  const [h1, h2] =
    p1Move === null || p2Move === null ? [100, 100] : healthFor(p1Move, p2Move, koGap(roundSecs));
  return (
    <div className="flex items-center gap-3">
      <Bar health={h1} side="p1" />
      <span className="display text-2xl text-gold">VS</span>
      <Bar health={h2} side="p2" />
    </div>
  );
}

function Bar({ health, side }: { health: number; side: "p1" | "p2" }) {
  const low = health < 30;
  return (
    <div
      className={`relative h-5 flex-1 overflow-hidden bg-panel-2 ring-1 ring-line ${
        side === "p1" ? "plate-left" : "plate-right"
      }`}
      role="meter"
      aria-valuenow={Math.round(health)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${side === "p1" ? "Player one" : "Player two"} health`}
    >
      <div
        className={`bar-fill absolute inset-y-0 ${side === "p1" ? "right-0" : "left-0"} ${
          low ? "bg-down" : side === "p1" ? "bg-p1" : "bg-p2"
        }`}
        style={{ width: `${health}%` }}
      />
    </div>
  );
}
