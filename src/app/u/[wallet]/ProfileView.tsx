"use client";

/* A fighter, as the chain remembers them.
 *
 * Everything here is read from duel accounts and the handle registry, through
 * the same derive layer the leaderboard uses, so the record on this page is
 * the record on the board, to the cent. Nothing is stored about a wallet
 * anywhere else, because nothing needs to be.
 *
 * The list every board reads keeps out fights staked in devnet test tokens,
 * and so does this record. Those fights did happen, though, so the history
 * counts them in a visible line and shows them on request, read separately for
 * this wallet only rather than by loosening the filter every board relies on. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { ConnectX, xStartHref } from "@/components/ConnectX";
import { FightRow } from "@/components/FightRow";
import { FirstFightOffer } from "@/components/FirstFightOffer";
import { cx } from "@/components/ui/cx";
import { Empty } from "@/components/ui/Empty";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { FighterName } from "@/components/ui/FighterName";
import { FormPips } from "@/components/ui/FormPips";
import { FighterAvatar } from "@/components/ui/FighterAvatar";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { StatStrip } from "@/components/ui/StatStrip";
import { toast } from "@/components/ui/Toast";
import {
  allDuels,
  decodeDuel,
  duelsAcceptedBy,
  duelsCreatedBy,
  PROGRAM_ID,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  type DuelView,
} from "@/lib/duel";
import {
  headToHead,
  isDeadHeat,
  isDecided,
  isRosterFight,
  recordFor,
  winnerSide,
  winRate,
  type Result,
} from "@/lib/derive";
import { shares, until, usd } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { stakeValue, usePrices } from "@/lib/prices";
import { CLUSTER, decimalsForMint, tickerForMint, tokenSymbol } from "@/lib/stocks";
import { useHoldings } from "@/lib/useHoldings";
import { useNow } from "@/lib/useNow";

const PAGE = 20;

/** The latest thing that happened to a fight, for ordering a history. */
const lastActivity = (d: DuelView, now: number) =>
  Math.max(d.createdTs, d.acceptedTs, d.startTs, d.endTs > 0 && (!now || d.endTs <= now) ? d.endTs : 0);

const involves = (d: DuelView, wallet: string) => d.creator.toBase58() === wallet || d.opponent.toBase58() === wallet;

/* Fights this wallet was in that the shared list leaves out. Two memcmp reads
 * (as creator, as answerer), decoded here and kept only when a side is not a
 * listed stock. Slow-moving, so it is read once a minute at most. */
function useTestFights(wallet: string) {
  const { connection } = useConnection();
  return useQuery<DuelView[]>({
    queryKey: ["test-fights", wallet],
    queryFn: async () => {
      const key = new PublicKey(wallet);
      const [made, took] = await Promise.all([
        connection.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: duelsCreatedBy(key) }),
        connection.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters: duelsAcceptedBy(key) }),
      ]);
      const seen = new Map<string, DuelView>();
      for (const a of [...made, ...took]) {
        try {
          const d = decodeDuel(a.pubkey, a.account.data);
          if (!isRosterFight(d)) seen.set(a.pubkey.toBase58(), d);
        } catch {
          /* Not a duel this client can read. */
        }
      }
      return [...seen.values()];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function ProfileView({ wallet }: { wallet: string }) {
  const duels = useDuels("all", allDuels());
  const profiles = useProfiles();
  const { publicKey } = useWallet();
  const now = useNow();
  const tests = useTestFights(wallet);

  const [shown, setShown] = useState(PAGE);
  const [showTests, setShowTests] = useState(false);

  const self = publicKey?.toBase58() === wallet;
  const handle = profiles.data?.[wallet];

  const mine = useMemo(() => (duels.data ?? []).filter((d) => involves(d, wallet)), [duels.data, wallet]);
  const record = useMemo(() => recordFor(wallet, mine), [wallet, mine]);
  const rivals = useMemo(() => headToHead(wallet, mine), [wallet, mine]);
  const favourites = useMemo(() => favouriteStocks(wallet, mine), [wallet, mine]);

  // Ordered on a coarse clock, so a live countdown does not re-sort the list every second.
  const minute = Math.floor(now / 60) * 60;
  const history = useMemo(
    () => [...mine].sort((a, b) => lastActivity(b, minute) - lastActivity(a, minute)),
    [mine, minute],
  );
  const openByThem = useMemo(
    () =>
      mine
        .filter((d) => d.status === STATUS_OPEN && d.creator.toBase58() === wallet && (!minute || d.expiresTs > minute))
        .sort((a, b) => a.expiresTs - b.expiresTs),
    [mine, wallet, minute],
  );
  const testFights = useMemo(
    () => [...(tests.data ?? [])].sort((a, b) => lastActivity(b, minute) - lastActivity(a, minute)),
    [tests.data, minute],
  );

  const visible = history.slice(0, shown);
  // Live prices only for rows that move with them, and never more than one request carries.
  const moving = visible.filter((d) => d.status === STATUS_LIVE || d.status === STATUS_OPEN);
  const prices = usePrices(moving.flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      toast.push({ title: "Address copied", check: true, ttlMs: 3_000 });
    } catch {
      toast.push({ title: "Could not copy. Select the address in the explorer link instead." });
    }
  };

  const header = (
    /* The name keeps at least 14rem, so on a phone the action drops under it
     * at full width instead of squeezing the name down to three letters. */
    <Plate notch pad="std" className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <FighterAvatar wallet={wallet} size={48} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="label">Fighter</p>
        <h1 className="mt-1 flex min-w-0 items-center">
          <FighterName wallet={wallet} size="lg" href={null} avatar={false} you={self} />
        </h1>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-meta">
          {/* The title above is already the short address when there is no
            * handle, so the link names where it goes instead of printing it twice. */}
          <ExplorerLink kind="address" value={wallet} label={handle ? undefined : "View on explorer"} />
          <button
            type="button"
            onClick={copy}
            className="label -my-2 py-2 whitespace-nowrap transition-colors hover:text-ink"
          >
            Copy address
          </button>
          {handle ? (
            <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer" className="link">
              @{handle} on X<span aria-hidden="true"> &#8599;</span>
            </a>
          ) : null}
          {/* Linking again is how a picture changes (or arrives, for a handle
            * linked before pictures were written). */}
          {handle && self ? (
            <a href={xStartHref(`/u/${wallet}`)} className="label -my-2 py-2 whitespace-nowrap transition-colors hover:text-ink">
              Refresh X picture
            </a>
          ) : null}
        </div>
      </div>
      {!self ? (
        <Link href={`/new?invite=${wallet}`} className="btn btn-sm btn-primary w-full shrink-0 sm:w-auto">
          Challenge this fighter
        </Link>
      ) : null}
    </Plate>
  );

  // #connect-x is where the wallet menu's "Show my X handle" lands.
  const connect =
    self && profiles.isSuccess && !handle ? (
      <div id="connect-x" className="scroll-mt-20">
        <ConnectX compact />
      </div>
    ) : null;

  if (duels.isError && !duels.data) {
    return (
      <div className="flex flex-col gap-6 py-6">
        {header}
        <Notice
          tone="error"
          title="Could not reach Solana."
          action={
            <button type="button" onClick={() => void duels.refetch()} className="btn btn-sm btn-ghost">
              Retry
            </button>
          }
        >
          This record fills in as soon as it answers.
        </Notice>
      </div>
    );
  }

  if (!duels.data) {
    return (
      <div className="flex flex-col gap-6 py-6" aria-busy="true">
        {header}
        <Skeleton className="h-32 w-full sm:h-20" />
        <SkeletonRows kind="fight" rows={4} />
      </div>
    );
  }

  const testToggle =
    testFights.length > 0 ? (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={showTests}
          aria-controls="profile-test-fights"
          onClick={() => setShowTests((v) => !v)}
          className="self-start text-meta text-dim underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
        >
          {showTests ? "Hide" : "Show"} {testFights.length} test-token {testFights.length === 1 ? "fight" : "fights"}
        </button>
        {showTests ? (
          <div id="profile-test-fights" className="flex flex-col gap-2">
            <p className="text-meta text-dim">
              Staked in devnet test tokens rather than listed stocks, so they count on no board and in no record here.
            </p>
            {testFights.map((d) => (
              <FightRow key={d.address.toBase58()} d={d} now={now} viewer={wallet} you={self} />
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  const holdingsRail = <HoldingsRail wallet={wallet} fights={mine} self={self} />;

  if (mine.length === 0) {
    /* A wallet with no fights still has a next step, and for the viewer's own
     * page it is a real one: the open seat nearest its deadline that this
     * wallet may take, named with its stake, before the generic "Pick a fight"
     * (FirstFightOffer, which My fights shares). */
    return (
      <div className="flex flex-col gap-6 py-6">
        {header}
        {connect}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            {self ? (
              <FirstFightOffer duels={duels.data} wallet={wallet} now={now} />
            ) : (
              // On someone else's page the challenge above is the one side-coloured action.
              <Empty title="No fights on chain for this wallet yet." action={{ href: "/new", label: "Pick a fight", tone: "ghost" }} />
            )}
            {testToggle}
          </div>
          <aside className="flex min-w-0 flex-col gap-6" aria-label="About this wallet">
            {holdingsRail}
          </aside>
        </div>
      </div>
    );
  }

  const rate = record.fights > 0 ? `${Math.round(winRate(record) * 100)}%` : "--";
  const took = record.taken >= 0.005;

  return (
    <div className="flex flex-col gap-6 py-6">
      {header}
      {connect}

      <StatStrip
        label="Record"
        cols={{ base: 2, sm: 4, lg: 7 }}
        cells={[
          {
            label: "Record",
            value: (
              <>
                {record.wins}W <span className="text-dim">{record.losses}L</span>
                {record.ties ? <span className="text-dim"> {record.ties}T</span> : null}
              </>
            ),
            sub: <FormPips results={record.form} />,
          },
          { label: "Win rate", value: <span className="num">{rate}</span> },
          { label: "Streak", value: record.streak },
          { label: "Best streak", value: record.best },
          {
            label: "Taken",
            value: <span className={cx("num", took ? "text-up" : "text-dim")}>{usd(record.taken)}</span>,
          },
          {
            label: "Lost",
            // Ink, not red: a loss in a record is not a price move. Dim when it is nothing.
            value: <span className={cx("num", record.lost >= 0.005 ? "text-ink" : "text-dim")}>{usd(record.lost)}</span>,
          },
          { label: "Fights", value: mine.length, sub: `${record.fights} with a result` },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="profile-history">
          <SectionHead id="profile-history" title="History" count={history.length} />
          <div className="flex flex-col gap-2">
            {visible.map((d) => (
              <FightRow key={d.address.toBase58()} d={d} now={now} quotes={prices.data} viewer={wallet} you={self} />
            ))}
          </div>
          {history.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="btn btn-sm btn-ghost self-start">
              Show {Math.min(PAGE, history.length - shown)} more
            </button>
          ) : null}
          {testToggle}
        </section>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="About this fighter">
          {holdingsRail}
          {openByThem.length ? (
            <section className="flex flex-col gap-3" aria-labelledby="profile-open">
              <SectionHead id="profile-open" title="Open challenges" count={openByThem.length} />
              <ul className="card flex flex-col">
                {openByThem.map((d) => (
                  <li key={d.address.toBase58()} className="border-t border-line first:border-t-0">
                    <OpenRow d={d} now={now} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {favourites.length ? (
            <section className="flex flex-col gap-3" aria-labelledby="profile-stocks">
              <SectionHead id="profile-stocks" title="Favourite stocks" />
              <ul className="card flex flex-col">
                {favourites.map((f) => (
                  <li
                    key={f.ticker}
                    className="flex h-9 min-w-0 items-center gap-3 border-t border-line px-3 first:border-t-0"
                  >
                    <span className="display min-w-0 flex-1 truncate text-hud-xs text-ink">{f.ticker}</span>
                    <span className="num text-meta text-dim">
                      {f.fights} {f.fights === 1 ? "fight" : "fights"}
                    </span>
                    <RecordText w={f.wins} l={f.losses} t={f.ties} className="w-20 text-right" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {rivals.length ? (
            <section className="flex flex-col gap-3" aria-labelledby="profile-rivals">
              <SectionHead id="profile-rivals" title="Rivals" />
              <ul className="card flex flex-col">
                {rivals.map((r) => (
                  <li
                    key={r.wallet}
                    className="flex h-9 min-w-0 items-center gap-3 border-t border-line px-3 first:border-t-0"
                  >
                    <span className="flex min-w-0 flex-1">
                      <FighterName wallet={r.wallet} size="sm" />
                    </span>
                    <span className="num text-meta text-dim">
                      {r.fights} {r.fights === 1 ? "fight" : "fights"}
                    </span>
                    <RecordText w={r.wins} l={r.losses} t={r.ties} className="w-20 text-right" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/* ─── What the wallet holds, and what it has up ─────────────────────────── */

/* SHARES HELD AND STAKES UP. A profile used to be only a fight history, so a
 * wallet holding $1,000 of stock tokens with a stake waiting in escrow read as
 * empty. The holdings are the chain's token accounts (lib/useHoldings); the
 * escrow is every stake this wallet has in a fight still open, taken or live,
 * from the same duel list the history is built from, valued at live prices. */
function HoldingsRail({ wallet, fights, self }: { wallet: string; fights: DuelView[]; self: boolean }) {
  const { holdings, valued, total, unpriced } = useHoldings(wallet);

  const staked = fights
    .filter((d) => d.status === STATUS_OPEN || d.status === STATUS_ACCEPTED || d.status === STATUS_LIVE)
    .map((d) => {
      const asCreator = d.creator.toBase58() === wallet;
      const mint = asCreator ? d.creatorMint : d.opponentMint;
      return { ticker: tickerForMint(mint), raw: asCreator ? d.creatorAmount : d.opponentAmount, decimals: decimalsForMint(mint) };
    })
    .filter((s) => s.ticker && s.raw > BigInt(0));
  const stakePrices = usePrices(staked.map((s) => s.ticker));
  const stakeValues = staked.map((s) => stakeValue(s.raw, s.decimals, stakePrices.data?.quotes[s.ticker!]));
  const escrow = stakeValues.every((v) => v !== null) ? stakeValues.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="profile-shares">
      <SectionHead id="profile-shares" title="Shares held" count={valued.length || null} />
      <div className="card flex flex-col">
        {holdings.isError ? (
          <p className="px-3 py-2.5 text-meta text-dim">Could not reach Solana. Holdings fill in when it answers.</p>
        ) : !holdings.data ? (
          <div className="flex flex-col gap-2 px-3 py-2.5" aria-busy="true">
            <span className="sr-only">Loading holdings</span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : valued.length === 0 ? (
          <p className="px-3 py-2.5 text-meta text-dim">
            {self ? "No stock tokens in your wallet yet." : "No stock tokens in this wallet."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {valued.map((h) => (
              <li key={h.ticker} className="flex h-9 min-w-0 items-center gap-3 border-t border-line px-3 first:border-t-0">
                <Link href={`/s/${h.ticker}`} className="display w-16 shrink-0 truncate text-hud-xs text-ink hover:underline">
                  {h.ticker}
                </Link>
                <span className="num min-w-0 flex-1 truncate text-meta text-dim">
                  {shares(h.raw, h.decimals)} <span className="normal-case">{tokenSymbol(h.ticker)}</span>
                </span>
                <span className={cx("num shrink-0 text-meta", h.usd === null ? "text-dim" : "text-ink")}>
                  {h.usd === null ? "no price" : usd(h.usd)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {total !== null || staked.length ? (
          <dl className="flex flex-col border-t border-line px-3 py-2">
            {total !== null ? (
              <div className="flex h-7 items-center justify-between gap-3">
                <dt className="label">
                  Total now{CLUSTER !== "mainnet-beta" ? " · test shares" : ""}
                  {unpriced ? ` · ${unpriced} unpriced` : ""}
                </dt>
                <dd className="num text-sm text-ink">{usd(total)}</dd>
              </div>
            ) : null}
            {staked.length ? (
              <div className="flex h-7 items-center justify-between gap-3">
                <dt className="label">
                  In escrow · {staked.length} {staked.length === 1 ? "fight" : "fights"}
                </dt>
                <dd className="num text-sm text-ink">{escrow !== null ? usd(escrow) : "--"}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function RecordText({ w, l, t, className }: { w: number; l: number; t: number; className?: string }) {
  return (
    <span className={cx("num whitespace-nowrap text-meta", className)}>
      <span className="text-ink">{w}W</span> <span className="text-dim">{l}L</span>
      {t ? <span className="text-dim"> {t}T</span> : null}
    </span>
  );
}

/* An open challenge this wallet made: its stock in the challenger's corner,
 * what it staked, and when the offer lapses. */
function OpenRow({ d, now }: { d: DuelView; now: number }) {
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  return (
    <Link
      href={`/f/${d.address.toBase58()}`}
      className="row flex h-9 min-w-0 items-center gap-2 px-3 focus-visible:-outline-offset-2"
    >
      <span className="display text-hud-xs text-p1-soft">{t1}</span>
      <span className="micro text-dim">vs</span>
      <span className="display text-hud-xs text-p2-soft">{t2}</span>
      <span className="num min-w-0 flex-1 truncate text-meta text-dim">
        {shares(d.creatorAmount, decimalsForMint(d.creatorMint))} <span className="normal-case">{tokenSymbol(t1)}</span>
      </span>
      <span className="num shrink-0 text-meta text-dim">{now ? `closes ${until(d.expiresTs, now)}` : null}</span>
    </Link>
  );
}

type Favourite = { ticker: string; fights: number; wins: number; losses: number; ties: number };

/** The stocks this wallet put in its own corner most often, with how that side did. */
function favouriteStocks(wallet: string, duels: DuelView[]): Favourite[] {
  const table = new Map<string, Favourite>();
  for (const d of duels) {
    const side = d.creator.toBase58() === wallet ? "p1" : d.opponent.toBase58() === wallet ? "p2" : null;
    if (!side) continue;
    const ticker = tickerForMint(side === "p1" ? d.creatorMint : d.opponentMint);
    if (!ticker) continue;
    let f = table.get(ticker);
    if (!f) {
      f = { ticker, fights: 0, wins: 0, losses: 0, ties: 0 };
      table.set(ticker, f);
    }
    f.fights++;
    const result: Result | null = isDeadHeat(d) ? "T" : isDecided(d) ? (winnerSide(d) === side ? "W" : "L") : null;
    if (result === "W") f.wins++;
    else if (result === "L") f.losses++;
    else if (result === "T") f.ties++;
  }
  return [...table.values()]
    .sort((a, b) => b.fights - a.fights || b.wins - a.wins || a.ticker.localeCompare(b.ticker))
    .slice(0, 5);
}
