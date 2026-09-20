/* THE SECOND FIGHT, ONE TAP FROM THE BELL.
 *
 * A round ends, the K.O. lands, and the only thing offered was a rematch: a
 * full page with a thousand-stock picker, a ticket, probably the faucet again,
 * and then a wait on somebody who is never told. That is where a first session
 * died. There is nearly always an open seat that could be taken this second,
 * so the fight page now offers that seat by name.
 *
 * WHICH SEAT. One this wallet may take NOW: a listed pair, open, not its own,
 * not this fight, open to anyone or naming it, and whose two markets line up
 * at this moment (mixedHoursAt: a 15-minute seat waiting for Monday's open is
 * not a next fight on a Saturday). Among those, one whose stake the wallet
 * already holds comes first, because it skips the faucet; then the nearest
 * deadline, the same order the first-fight offer uses.
 *
 * Pure: the clock and the fairness rule are passed in, so tests can pin it. */

import { isRosterFight } from "./derive";
import { isInviteOnly, STATUS_OPEN, type DuelView } from "./duel";

export type SeatPick = { duel: DuelView; holdsStake: boolean };

export function nextSeat(
  duels: DuelView[],
  opts: {
    wallet: string | null | undefined;
    now: number;
    /** The fight being looked at, which is never its own next seat. */
    except?: string;
    /** Whether the wallet already holds this seat's stake: such a seat skips the faucet. */
    holds?: (d: DuelView) => boolean;
    /** Null when the pair can be taken fairly now; a sentence when it cannot. */
    blocked: (d: DuelView, now: number) => string | null;
  },
): SeatPick | null {
  const { wallet, now, except, blocked } = opts;
  if (!now) return null;
  const open = duels.filter(
    (d) =>
      isRosterFight(d) &&
      d.status === STATUS_OPEN &&
      d.expiresTs > now &&
      d.address.toBase58() !== except &&
      d.creator.toBase58() !== wallet &&
      (!isInviteOnly(d) || (!!wallet && d.invitee.toBase58() === wallet)) &&
      blocked(d, now) === null,
  );
  if (!open.length) return null;
  const holds = (d: DuelView) => !!opts.holds?.(d);
  open.sort((a, b) => Number(holds(b)) - Number(holds(a)) || a.expiresTs - b.expiresTs);
  return { duel: open[0], holdsStake: holds(open[0]) };
}
