/* The HUD: two health bars, fighting-game style. The arithmetic lives in
 * lib/health.ts; this only draws it. */

import { healthFor, koGap } from "@/lib/health";

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
      <span className="display text-2xl text-ink">VS</span>
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
