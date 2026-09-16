/* The HUD: two health bars, fighting-game style. The arithmetic lives in
 * lib/health.ts; this only draws it.
 *
 * LOW HEALTH IS STRIPED, NEVER RED. Red means a price went down, and the
 * fighter who is behind is not necessarily the one whose stock is falling:
 * both can be up. So a bar under 30 keeps its side's colour and takes the
 * danger stripes instead.
 *
 * `ko` is the side the program knocked out. At the bell the bars say what it
 * decided (settledHealth), so the loser's bar is empty however narrow the
 * margin was, instead of two nearly full bars under a K.O. */

import { healthFor, koGap, OUTCOME_CREATOR_WON, OUTCOME_OPPONENT_WON, settledHealth } from "@/lib/health";

const LOW = 30;

export function HealthBars({
  p1Move,
  p2Move,
  roundSecs = 86_400,
  ko = null,
  size = "md",
}: {
  p1Move: number | null;
  p2Move: number | null;
  roundSecs?: number;
  ko?: "p1" | "p2" | null;
  /** "lg" is the fight page's HUD row across the whole arena; "md" everywhere else. */
  size?: "md" | "lg";
}) {
  const known = p1Move !== null && p2Move !== null;
  let health: [number, number];
  if (ko) {
    const outcome = ko === "p1" ? OUTCOME_OPPONENT_WON : OUTCOME_CREATOR_WON;
    health = known ? settledHealth(p1Move, p2Move, outcome, roundSecs) : ko === "p1" ? [0, 100] : [100, 0];
  } else {
    health = known ? healthFor(p1Move, p2Move, koGap(roundSecs)) : [100, 100];
  }
  return (
    <div className={size === "lg" ? "flex items-center gap-4" : "flex items-center gap-3"}>
      <Bar health={health[0]} side="p1" size={size} />
      <span className="display text-hud-sm text-ink">VS</span>
      <Bar health={health[1]} side="p2" size={size} />
    </div>
  );
}

function Bar({ health, side, size }: { health: number; side: "p1" | "p2"; size: "md" | "lg" }) {
  const low = health < LOW;
  return (
    <div
      className={`relative ${size === "lg" ? "h-7" : "h-5"} min-w-0 flex-1 overflow-hidden bg-panel-2 ring-1 ring-line ${
        side === "p1" ? "plate-left" : "plate-right"
      }`}
      role="meter"
      aria-valuenow={Math.round(health)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${side === "p1" ? "Challenger" : "Opponent"} health`}
    >
      <div
        className={`bar-fill absolute inset-y-0 ${side === "p1" ? "right-0 bg-p1" : "left-0 bg-p2"} ${
          low ? `bar-danger side-${side}` : ""
        }`}
        style={{ width: `${health}%` }}
      />
    </div>
  );
}
