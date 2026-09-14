"use client";

/* THE RING: what is fighting, what is waiting, and what just finished.
 *
 * Order is the order somebody would care in. Rounds running now come first,
 * the one nearest its bell at the top; then fights taken and waiting for their
 * start; then open challenges, newest first, since a new one is the one most
 * likely to still be looking for a taker. Whatever room is left fills with the
 * latest results, bell first, so a quiet hour shows real recent fights with
 * their real ages instead of an empty ring. The empty state appears only when
 * no listed fight has ever existed.
 *
 * The list every board reads leaves out fights staked in devnet test tokens
 * (lib/hooks useDuels). Those fights still happened, so the board says how
 * many it is hiding and links to them, counted by a separate, very small read
 * rather than by loosening the filter. */

import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { FightRow, isLate } from "@/components/FightRow";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { allDuels, OFFSET_STATUS, PROGRAM_ID, STATUS_ACCEPTED, STATUS_LIVE, STATUS_OPEN, type DuelView } from "@/lib/duel";
import { isDeadHeat, isDecided, isRosterFight } from "@/lib/derive";
import { useDuels } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { CLUSTER, isListedDuel, tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

/* WHERE THE TWO MINTS SIT IN A DUEL ACCOUNT. After the status byte (whose
 * offset the program promises) come outcome (u8), seed (u64), invitee and
 * winner (32 bytes each), then creator_mint and opponent_mint, back to back,
 * as the vendored IDL lays them out. Reading just those 64 bytes per account
 * is enough to tell a listed fight from a test one, at a sliver of the cost of
 * the full list. */
const OFFSET_MINTS = OFFSET_STATUS + 1 + 1 + 8 + 32 + 32;
const MINTS_LEN = 64;

/** How many fights on chain are staked in something other than two listed
 *  stocks. Null until read, and never read on mainnet, which has no test mints. */
function useHiddenTestFights() {
  const { connection } = useConnection();
  return useQuery<number>({
    queryKey: ["duel-mints"],
    enabled: CLUSTER !== "mainnet-beta",
    queryFn: async () => {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: allDuels(),
        dataSlice: { offset: OFFSET_MINTS, length: MINTS_LEN },
      });
      let hidden = 0;
      for (const a of accounts) {
        const bytes = a.account.data;
        if (bytes.length !== MINTS_LEN) continue;
        const listed = isListedDuel({
          creatorMint: new PublicKey(bytes.subarray(0, 32)),
          opponentMint: new PublicKey(bytes.subarray(32, 64)),
        });
        if (!listed) hidden++;
      }
      return hidden;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/** The ring's order: live by bell, taken, open by newest, fights the settler
 *  is late on (FightRow isLate), then results. A stalled fight is still in
 *  play, but it is not what somebody opening the board came to see. */
export function ringOrder(duels: DuelView[], now: number, limit: number): DuelView[] {
  const roster = duels.filter(isRosterFight);
  const late = roster.filter((d) => isLate(d, now)).sort((a, b) => b.acceptedTs - a.acceptedTs);
  const moving = roster.filter((d) => !isLate(d, now));
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

export function LiveBoard({ limit = 12, columns = 1 }: { limit?: number; columns?: 1 | 2 }) {
  const duels = useDuels("all", allDuels());
  const hidden = useHiddenTestFights();
  const now = useNow();

  const all = duels.data ?? [];
  const shown = ringOrder(all, now, limit);
  // Only what is still in play needs a live price: a finished fight shows its own.
  const priced = shown.filter((d) => d.status === STATUS_OPEN || d.status === STATUS_ACCEPTED || d.status === STATUS_LIVE);
  const prices = usePrices(priced.flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]));

  const hiddenNote =
    hidden.data && hidden.data > 0 ? (
      <Link
        href="/fights?tab=final&test=1"
        className="micro self-start text-dim underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
      >
        {hidden.data} {hidden.data === 1 ? "fight" : "fights"} on devnet test tokens hidden
      </Link>
    ) : null;

  if (duels.isLoading) return <SkeletonRows kind="fight" rows={Math.min(limit, 6)} />;

  if (duels.error && !duels.data) {
    return (
      <Notice
        tone="error"
        title="Could not reach Solana."
        action={
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void duels.refetch()}>
            Retry
          </button>
        }
      >
        The ring fills in as soon as the chain answers.
      </Notice>
    );
  }

  if (!shown.length) {
    return (
      <div className="flex flex-col gap-2">
        <Empty
          title="No fights on chain yet."
          body="Pick two stocks, stake one, and send the link."
          action={{ href: "/new", label: "Pick a fight", tone: "p1" }}
        />
        {hiddenNote}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={columns === 2 ? "grid gap-2 md:grid-cols-2" : "flex flex-col gap-2"}>
        {shown.map((d) => (
          <FightRow key={d.address.toBase58()} d={d} now={now} quotes={prices.data} />
        ))}
      </div>
      {hiddenNote}
    </div>
  );
}
