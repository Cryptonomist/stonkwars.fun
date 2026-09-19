/* THE RING'S ORDER, as a pure function.
 *
 * Live rounds by bell, then fights taken and waiting for their start, then open
 * challenges newest first, then stuck fights, then results. A stuck fight is
 * still in play, but it is not what somebody opening the board came to see, so
 * it goes last and falls off a full board.
 *
 * "Stuck" is passed in rather than computed here. Deciding it needs a clock and
 * the markets' hours (a fight the settler is late on, or one whose start price
 * will never exist), which live with the board's rows; keeping that out means
 * the order can be tested with a plain predicate.
 *
 * It lives in lib/ because it used to live in the LiveBoard component, and the
 * one row it got wrong (a fight that can never start, sorted near the top of
 * the front page) could not be pinned by a test without importing a client
 * component into mocha. */

import { STATUS_ACCEPTED, STATUS_LIVE, STATUS_OPEN, type DuelView } from "./duel";
import { isDeadHeat, isDecided, isRosterFight } from "./derive";

export function ringOrder(
  duels: DuelView[],
  now: number,
  limit: number,
  stuck: (d: DuelView, now: number) => boolean,
): DuelView[] {
  const roster = duels.filter(isRosterFight);
  const late = roster.filter((d) => stuck(d, now)).sort((a, b) => b.acceptedTs - a.acceptedTs);
  const moving = roster.filter((d) => !stuck(d, now));
  const live = moving.filter((d) => d.status === STATUS_LIVE).sort((a, b) => a.endTs - b.endTs);
  const taken = moving.filter((d) => d.status === STATUS_ACCEPTED).sort((a, b) => b.acceptedTs - a.acceptedTs);
  const open = moving
    .filter((d) => d.status === STATUS_OPEN && (!now || d.expiresTs > now))
    .sort((a, b) => b.createdTs - a.createdTs);
  const active = [...live, ...taken, ...open, ...late].slice(0, limit);
  const finished = roster
    .filter((d) => isDecided(d) || isDeadHeat(d))
    .sort((a, b) => b.endTs - a.endTs)
    .slice(0, Math.max(0, limit - active.length));
  return [...active, ...finished];
}
