"use client";

/* EVERY FIGHT ON CHAIN, AS A BOARD.
 *
 * The Fights link used to land on one card a third of the page wide, on a tab
 * the URL forgot, over a list with no dates and no order. Most of what it
 * showed as "final" were old fights staked in devnet test tokens, two of them
 * with "?" for a ticker. This is the same list read as a board: one column of
 * the dense rows the home page uses, a tab that survives a refresh or a shared
 * link, filters that live in the URL too, and dates on the results.
 *
 * THE TABS. Live holds rounds running and fights taken and waiting for their
 * start, nearest bell first. Open holds challenges still inside their window,
 * newest first. Final holds every fight the program finished (a result, a dead
 * heat, a void), newest bell first under a date line per day in ET, the clock
 * the market keeps. Mine and Called out appear once a wallet is connected.
 *
 * THE DEFAULT TAB is whichever of Live, Open and Final has something in it,
 * decided once, when the chain first answers. Deciding it again on every poll
 * would yank a visitor from Open to Live mid-read the moment a round starts.
 * A tab somebody clicks goes into the URL; the undecided default stays out of
 * it (useUrlTab's fallback is a sentinel no tab ever equals).
 *
 * TEST FIGHTS. The list every board reads leaves out fights between anything
 * but two listed stocks (lib/hooks useDuels), and that filter is not loosened
 * here. The test fights come from their own read, which is used for two
 * things only: saying how many this tab is hiding, and showing them when the
 * URL says test=1. They really were fought on chain, so they are never
 * dropped from the count, only from the default view. */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { FightRow, isLate } from "@/components/FightRow";
import { cx } from "@/components/ui/cx";
import { Empty } from "@/components/ui/Empty";
import { FighterName } from "@/components/ui/FighterName";
import { requestConnect } from "@/components/ui/intents";
import { LiveDot } from "@/components/ui/LiveDot";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { Tabs, useUrlTab, type TabItem } from "@/components/ui/Tabs";
import {
  allDuels,
  decodeDuel,
  PROGRAM_ID,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "@/lib/duel";
import { calledOut, lastBell } from "@/lib/derive";
import { ago } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { byTicker, CLUSTER, isListedDuel, tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

type TabId = "live" | "open" | "final" | "mine" | "called";

/** The URL's tab when it names none: "work it out from what is on chain". */
const AUTO = "auto";
type UrlTab = TabId | typeof AUTO;
const URL_TABS: readonly UrlTab[] = [AUTO, "live", "open", "final", "mine", "called"];

const TAB_LABEL: Record<TabId, string> = {
  live: "Live",
  open: "Open",
  final: "Final",
  mine: "Mine",
  called: "Called out",
};

/** The tab's fights in a phrase: "Stocks in open fights", "in your fights". */
const TAB_SCOPE: Record<TabId, string> = {
  live: "live",
  open: "open",
  final: "final",
  mine: "your",
  called: "called-out",
};

/** Rows per step. A board, not an infinite scroll. */
const PAGE = 30;

/** The default key: an empty opponent slot. */
const EMPTY_KEY = "11111111111111111111111111111111";

/* ─── Reading the list ───────────────────────────────────────────────────── */

const isFinished = (d: DuelView) =>
  d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED || d.status === STATUS_VOID;

/* WHEN A FINISHED FIGHT FINISHED, as near as the account says. A result or a
 * dead heat rang its bell at endTs. A fight refunded after stalling has no
 * recorded refund time and its endTs can still be ahead, so it is placed no
 * later than now; one with no end at all falls back to its latest real step. */
function finishedAt(d: DuelView, now: number): number {
  const t = d.endTs > 0 ? d.endTs : d.startTs || d.acceptedTs || d.createdTs;
  return now > 0 ? Math.min(t, now) : t;
}

/** The latest thing that happened to a fight, for lists of one wallet's fights. */
const latestStep = (d: DuelView) => Math.max(d.createdTs, d.acceptedTs, d.endTs);

const byAddress = (a: DuelView, b: DuelView) => a.address.toBase58().localeCompare(b.address.toBase58());

/* Every tab's list, each in the order its tab is read in.
 *
 * Live ends with the fights the settler is late on (FightRow isLate), under
 * their own line, and `late` says how many there are. They are still in play,
 * so they stay on the tab, but the tab's count leaves them out: a count of 2
 * beside a header saying one round is live read as a board padding itself. */
function tabLists(duels: DuelView[], now: number, me: string | null): Record<TabId, DuelView[]> & { late: DuelView[] } {
  const late = duels
    .filter((d) => isLate(d, now))
    .sort((a, b) => b.acceptedTs - a.acceptedTs || byAddress(a, b));
  const moving = duels.filter((d) => !isLate(d, now));
  const live = moving.filter((d) => d.status === STATUS_LIVE).sort((a, b) => a.endTs - b.endTs || byAddress(a, b));
  const taken = moving
    .filter((d) => d.status === STATUS_ACCEPTED)
    .sort((a, b) => b.acceptedTs - a.acceptedTs || byAddress(a, b));
  const recent = (a: DuelView, b: DuelView) => latestStep(b) - latestStep(a) || byAddress(a, b);
  return {
    late,
    live: [...live, ...taken, ...late],
    open: duels
      .filter((d) => d.status === STATUS_OPEN && d.expiresTs > now)
      .sort((a, b) => b.createdTs - a.createdTs || byAddress(a, b)),
    final: duels
      .filter(isFinished)
      .sort((a, b) => finishedAt(b, now) - finishedAt(a, now) || byAddress(a, b)),
    mine: me
      ? duels.filter((d) => d.creator.toBase58() === me || d.opponent.toBase58() === me).sort(recent)
      : [],
    called: me ? calledOut(me, duels, now).sort(recent) : [],
  };
}

/* A DAY IN NEW YORK, "Sat 12 Sep", and a key that sorts with it. Built from
 * formatToParts for the same reason lib/format is: toLocaleString output
 * differs between ICU builds. */
const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function etDay(unix: number, now: number): { key: string; label: string } {
  const parts: Record<string, string> = {};
  for (const p of ET_DAY.formatToParts(new Date(unix * 1000))) parts[p.type] = p.value;
  const thisYear = now > 0 && ET_DAY.formatToParts(new Date(now * 1000)).find((p) => p.type === "year")?.value;
  const year = thisYear && thisYear !== parts.year ? ` ${parts.year}` : "";
  return { key: `${parts.year}-${parts.month}-${parts.day}`, label: `${parts.weekday} ${parts.day} ${parts.month}${year}` };
}

/* The test fights: every duel account the listed read leaves out. Never read
 * on mainnet, which has no test mints. Old and finished, so polled slowly. */
function useUnlistedFights() {
  const { connection } = useConnection();
  return useQuery<DuelView[]>({
    queryKey: ["duels-unlisted"],
    enabled: CLUSTER !== "mainnet-beta",
    queryFn: async () => {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: allDuels(),
      });
      const out: DuelView[] = [];
      for (const a of accounts) {
        try {
          const d = decodeDuel(a.pubkey, a.account.data);
          if (!isListedDuel(d)) out.push(d);
        } catch {
          /* Not a duel this client can read. */
        }
      }
      return out;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** How many fights each ticker is in, most first; a fight counts once per ticker. */
function tickerCounts(duels: DuelView[], limit: number): { ticker: string; n: number }[] {
  const n = new Map<string, number>();
  for (const d of duels) {
    for (const t of new Set([tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)])) {
      if (t) n.set(t, (n.get(t) ?? 0) + 1);
    }
  }
  return [...n]
    .map(([ticker, count]) => ({ ticker, n: count }))
    .sort((a, b) => b.n - a.n || a.ticker.localeCompare(b.ticker))
    .slice(0, limit);
}

/** How many fights each wallet is in, most first. */
function fighterCounts(duels: DuelView[], limit: number): { wallet: string; n: number }[] {
  const n = new Map<string, number>();
  for (const d of duels) {
    for (const w of new Set([d.creator.toBase58(), d.opponent.toBase58()])) {
      if (w !== EMPTY_KEY) n.set(w, (n.get(w) ?? 0) + 1);
    }
  }
  return [...n]
    .map(([wallet, count]) => ({ wallet, n: count }))
    .sort((a, b) => b.n - a.n || a.wallet.localeCompare(b.wallet))
    .slice(0, limit);
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/* ─── The board ──────────────────────────────────────────────────────────── */

export function FightsBoard() {
  const duels = useDuels("all", allDuels());
  const unlisted = useUnlistedFights();
  const profiles = useProfiles();
  const now = useNow();
  const { publicKey, connecting } = useWallet();
  const me = publicKey?.toBase58() ?? null;

  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [urlTab, setUrlTab] = useUrlTab<UrlTab>("tab", URL_TABS, AUTO);

  /* Filters, straight from the URL, so a refresh or a pasted link keeps them. */
  const rawWallet = params.get("w");
  const rawTicker = params.get("t")?.trim() || null;
  const withTests = params.get("test") === "1";
  const wallet = useMemo(() => {
    if (!rawWallet) return null;
    try {
      return new PublicKey(rawWallet).toBase58();
    } catch {
      return null;
    }
  }, [rawWallet]);
  const tickerUp = rawTicker?.toUpperCase() ?? null;
  const tickerShown = rawTicker ? (byTicker(tickerUp!)?.ticker ?? rawTicker) : null;
  const filterCount = (rawWallet ? 1 : 0) + (rawTicker ? 1 : 0) + (withTests ? 1 : 0);

  /** This page's URL with some params set (or removed, with null), the rest kept. */
  const hrefWith = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );
  /* Replace rather than push, as the tabs do: flicking through filters should
   * not fill the back button with them. */
  const setParams = useCallback(
    (patch: Record<string, string | null>) => router.replace(hrefWith(patch), { scroll: false }),
    [router, hrefWith],
  );

  const listed = duels.data ?? [];
  const tests = unlisted.data ?? [];
  const pool = withTests ? [...listed, ...tests] : listed;

  /* A wallet that does not parse matches nothing, and its chip says why,
   * rather than the filter silently doing nothing. */
  const matchWallet = (d: DuelView) =>
    !rawWallet || (!!wallet && (d.creator.toBase58() === wallet || d.opponent.toBase58() === wallet));
  const matchTicker = (d: DuelView) =>
    !tickerUp ||
    tickerForMint(d.creatorMint)?.toUpperCase() === tickerUp ||
    tickerForMint(d.opponentMint)?.toUpperCase() === tickerUp;

  const ready = !!duels.data && now > 0;
  const lists = tabLists(pool.filter((d) => matchWallet(d) && matchTicker(d)), now, me);

  const fallbackTab: TabId = lists.live.length > lists.late.length ? "live" : lists.open.length ? "open" : "final";
  const [autoTab, setAutoTab] = useState<TabId | null>(null);
  if (ready && autoTab === null) setAutoTab(fallbackTab);
  const tab: TabId = urlTab === AUTO ? (autoTab ?? fallbackTab) : urlTab;

  const list = lists[tab];
  const hiddenTests =
    withTests || !ready ? 0 : tabLists(tests.filter((d) => matchWallet(d) && matchTicker(d)), now, me)[tab].length;

  /* Show 30, then 30 more. A new tab or filter starts again at 30. */
  const viewKey = `${tab}|${rawWallet ?? ""}|${rawTicker ?? ""}|${withTests ? 1 : 0}`;
  const [more, setMore] = useState({ key: viewKey, n: PAGE });
  const limit = more.key === viewKey ? more.n : PAGE;
  const visible = list.slice(0, limit);

  // Only what is still in play needs a live price: a finished fight shows its own.
  const prices = usePrices(
    visible
      .filter((d) => d.status === STATUS_OPEN || d.status === STATUS_ACCEPTED || d.status === STATUS_LIVE)
      .flatMap((d) => [tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)]),
  );

  /* The rail: what is on this tab, before the ticker filter narrows it, so
   * every stock chip is one tap from swapping to another. */
  const beforeTicker = tabLists(pool.filter(matchWallet), now, me)[tab];
  const stocks = tickerCounts(beforeTicker, 10);
  /* Fighters who are in more than one of these fights. A column of "1 fight"
   * rows would be a list of addresses, not a shortcut; the search box takes
   * any wallet. */
  const fighters = fighterCounts(list, 5).filter((f) => f.n > 1 || f.wallet === wallet);

  const inbox = me && ready ? calledOut(me, pool, now) : [];

  /* ── The header, from the listed fights, filters aside ── */
  const liveNow = listed.filter((d) => d.status === STATUS_LIVE && d.endTs > now).length;
  const openNow = listed.filter((d) => d.status === STATUS_OPEN && d.expiresTs > now).length;
  const settled = listed.filter((d) => d.status === STATUS_SETTLED).length;
  const bell = lastBell(listed);
  const stat = (value: ReactNode) => (ready ? value : <Skeleton className="h-4 w-10" />);

  const header = (
    <PageHeader
      eyebrow="On chain"
      title="Fights"
      stats={[
        liveNow > 0
          ? {
              /* Rounds running, not the Live tab's count, which also holds
               * fights taken and waiting for their start. */
              label: "Rounds live",
              value: stat(
                <span className="inline-flex items-center gap-2">
                  <LiveDot />
                  {liveNow}
                </span>,
              ),
            }
          : { label: "Last bell", value: stat(bell ? ago(bell, now) : "none yet") },
        /* Short labels, so the three sit on one line on a phone instead of
         * taking a third of its first screen. */
        { label: "Open", value: stat(openNow.toLocaleString("en-US")) },
        { label: "Settled", value: stat(settled.toLocaleString("en-US")) },
      ]}
      action={
        /* A phone has this button in the bar under its thumb already. */
        <Link href="/new" className="btn btn-p1 hidden sm:inline-flex">
          Pick a fight
        </Link>
      }
    />
  );

  if (duels.isError && !duels.data) {
    return (
      <div className="pb-6">
        {header}
        <Notice
          tone="error"
          title="Could not reach Solana."
          action={
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void duels.refetch()}>
              Retry
            </button>
          }
        >
          The board fills in as soon as the chain answers.
        </Notice>
      </div>
    );
  }

  /* Live's count leaves out fights the settler is late on; they are listed
   * under their own line (tabLists). */
  const count = (id: TabId) => (ready ? lists[id].length - (id === "live" ? lists.late.length : 0) : null);
  const items: TabItem<TabId>[] = [
    { id: "live", label: TAB_LABEL.live, count: count("live") },
    { id: "open", label: TAB_LABEL.open, count: count("open") },
    { id: "final", label: TAB_LABEL.final, count: count("final") },
  ];
  /* Mine and Called out belong to a wallet. Without one they stay hidden,
   * unless a link asked for one of them, which then says to connect. */
  if (me || tab === "mine") items.push({ id: "mine", label: TAB_LABEL.mine, count: me ? count("mine") : null });
  if (me || tab === "called") items.push({ id: "called", label: TAB_LABEL.called, count: me ? count("called") : null });

  const needsWallet = tab === "mine" || tab === "called";
  const clearFilters = () => setParams({ w: null, t: null, test: null });

  const panel = (
    <FilterPanel
      stocks={stocks}
      fighters={fighters}
      ticker={tickerShown}
      wallet={wallet}
      handles={profiles.data}
      scope={TAB_SCOPE[tab]}
      hiddenTests={hiddenTests}
      onTicker={(t) => setParams({ t })}
      onWallet={(w) => setParams({ w })}
      onShowTests={() => setParams({ test: "1" })}
    />
  );

  let body: ReactNode;
  if (!ready || (needsWallet && !me && connecting)) {
    body = <SkeletonRows kind="fight" rows={8} />;
  } else if (needsWallet && !me) {
    body = (
      <Empty
        title={tab === "mine" ? "Connect to see your fights." : "Connect to see who called you out."}
        body="No extension needed: the guest wallet lives in this browser."
        action={
          <button type="button" className="btn btn-sm btn-light" onClick={() => requestConnect()}>
            Connect
          </button>
        }
      />
    );
  } else if (list.length === 0) {
    body = (
      <TabEmpty
        tab={tab}
        filtered={!!rawWallet || !!rawTicker}
        unfiltered={tabLists(pool, now, me)[tab].length}
        bell={bell}
        now={now}
        hrefWith={hrefWith}
        onClear={clearFilters}
      />
    );
  } else if (tab === "final") {
    body = <DatedList all={list} visible={visible} now={now} quotes={prices.data} />;
  } else {
    const lateFrom = tab === "live" ? list.length - lists.late.length : list.length;
    const rows = (from: number, to: number) => (
      <ul className="flex flex-col gap-2">
        {visible.slice(from, to).map((d) => (
          <li key={d.address.toBase58()} className="min-w-0">
            <FightRow d={d} now={now} quotes={prices.data} />
          </li>
        ))}
      </ul>
    );
    body =
      lateFrom < visible.length ? (
        <>
          {lateFrom > 0 ? rows(0, lateFrom) : null}
          <section aria-label="The settler is late" className="flex min-w-0 flex-col gap-2">
            <h2 className="micro flex items-center gap-3 text-dim">
              <span className="shrink-0">Settler late · anyone can post the prices</span>
              <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-line" />
              <span className="num shrink-0">{plural(lists.late.length, "fight", "fights")}</span>
            </h2>
            {rows(lateFrom, visible.length)}
          </section>
        </>
      ) : (
        rows(0, visible.length)
      );
  }

  /* A SHORT TAB STILL LOOKS LIKE A BOARD. With fewer than four rows the page
   * used to end a fifth of the way down, over a void, and read as broken
   * rather than quiet. Real recent results fill the rest, under their own
   * head, so nothing pretends to be on the tab it is not on. They follow the
   * same filters, so a ticker filter tops up with that stock's results. */
  const latest = lists.final.slice(0, 5);
  const topUp =
    ready && tab !== "final" && !(needsWallet && !me) && list.length < 4 && latest.length ? (
      <section aria-labelledby="latest-results" className="mt-6 flex min-w-0 flex-col gap-2">
        <SectionHead
          id="latest-results"
          title="Latest results"
          action={{ href: hrefWith({ tab: "final" }), label: "All results" }}
        />
        <ul className="flex flex-col gap-2">
          {latest.map((d) => (
            <li key={d.address.toBase58()} className="min-w-0">
              <FightRow d={d} now={now} />
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <div className="pb-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <FilterToolbar
            items={items}
            tab={tab}
            onTab={(id) => setUrlTab(id)}
            filterCount={filterCount}
            filterKey={`${rawWallet ?? ""}|${rawTicker ?? ""}|${withTests ? 1 : 0}`}
            panel={panel}
          />

          {filterCount > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Filters">
              {rawWallet ? (
                <Chip label="Fighter" removeLabel="Remove the fighter filter" onRemove={() => setParams({ w: null })}>
                  {wallet ? (
                    <FighterName wallet={wallet} size="sm" />
                  ) : (
                    <span className="truncate text-meta text-dim">not a wallet address</span>
                  )}
                </Chip>
              ) : null}
              {tickerShown ? (
                <Chip label="Stock" removeLabel={`Remove the ${tickerShown} filter`} onRemove={() => setParams({ t: null })}>
                  <span className="display truncate text-hud-xs normal-case">{tickerShown}</span>
                </Chip>
              ) : null}
              {withTests ? (
                <Chip label="Test tokens" removeLabel="Hide test-token fights" onRemove={() => setParams({ test: null })}>
                  <span className="text-meta text-ink">shown</span>
                </Chip>
              ) : null}
              {filterCount > 1 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-10 px-2 text-meta text-dim underline decoration-line-strong underline-offset-4 hover:text-ink sm:h-8"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          ) : null}

          {inbox.length > 0 && tab !== "called" ? (
            <Notice
              title={
                inbox.length === 1
                  ? `You were called out: ${tickerForMint(inbox[0].creatorMint) ?? "?"} vs ${tickerForMint(inbox[0].opponentMint) ?? "?"}.`
                  : `You were called out ${inbox.length} times.`
              }
              action={
                <button type="button" className="btn btn-sm btn-light" onClick={() => setUrlTab("called")}>
                  {inbox.length === 1 ? "See it" : "See them"}
                </button>
              }
            >
              {inbox.length === 1 ? "Only your wallet can take it." : "Only your wallet can take them."}
            </Notice>
          ) : null}

          <div id="fights-list" role="tabpanel" aria-label={TAB_LABEL[tab]} className="flex min-w-0 flex-col gap-3">
            {body}

            {ready && list.length > limit ? (
              <div className="flex flex-col items-center gap-2 pt-2">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setMore({ key: viewKey, n: limit + PAGE })}
                >
                  Show {Math.min(PAGE, list.length - limit)} more
                </button>
                <p className="micro num text-dim">
                  {limit} of {list.length}
                </p>
              </div>
            ) : null}

            {hiddenTests > 0 ? (
              <button
                type="button"
                onClick={() => setParams({ test: "1" })}
                className="self-start text-meta text-dim underline decoration-line-strong underline-offset-4 hover:text-ink lg:hidden"
              >
                Show {plural(hiddenTests, "test-token fight", "test-token fights")}
              </button>
            ) : null}
          </div>

          {topUp}
        </div>

        <aside className="hidden min-w-0 lg:sticky lg:top-20 lg:block lg:self-start" aria-label="Filter the fights">
          {panel}
        </aside>
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

/* The tabs, and on a phone a Filter button that opens the same panel the
 * desktop rail shows, in place, above the list. Picking a filter closes it:
 * the panel is opened for one set of filters (`filterKey`), so the moment
 * they change the list comes back up under the thumb instead of staying a
 * screen below an open panel. */
function FilterToolbar({
  items,
  tab,
  onTab,
  filterCount,
  filterKey,
  panel,
}: {
  items: TabItem<TabId>[];
  tab: TabId;
  onTab: (id: TabId) => void;
  filterCount: number;
  filterKey: string;
  panel: ReactNode;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === filterKey;
  const setOpen = (fn: (v: boolean) => boolean) => setOpenFor(fn(open) ? filterKey : null);
  const panelId = useId();
  return (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Tabs items={items} value={tab} onChange={onTab} ariaLabel="Fights" controls="fights-list" className="min-w-0" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={cx("btn btn-sm shrink-0 lg:hidden", open ? "btn-light" : "btn-ghost")}
        >
          Filter
          {filterCount > 0 ? (
            <span className={cx("micro num", open ? "text-void" : "text-dim")}>{filterCount}</span>
          ) : null}
        </button>
      </div>
      {open ? (
        <div id={panelId} className="min-w-0 lg:hidden">
          {panel}
        </div>
      ) : null}
    </>
  );
}

/* A filter that is on, and the way to turn it off. The remove button is 40px
 * tall on a phone, which is the smallest a thumb should be asked to hit. */
function Chip({
  label,
  removeLabel,
  onRemove,
  children,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex h-10 max-w-full min-w-0 items-center gap-2 bg-panel-2 pl-3 ring-1 ring-line ring-inset sm:h-8">
      <span className="label shrink-0">{label}</span>
      <span className="flex min-w-0 items-center">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="flex h-10 w-10 shrink-0 items-center justify-center text-dim transition-colors hover:bg-panel-3 hover:text-ink focus-visible:-outline-offset-2 sm:h-8 sm:w-8"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </span>
  );
}

/* FINAL, WITH A DATE LINE PER DAY. The count on each line is that day's whole
 * count on this tab, even when "Show more" has not reached all of it yet. */
function DatedList({
  all,
  visible,
  now,
  quotes,
}: {
  all: DuelView[];
  visible: DuelView[];
  now: number;
  quotes: Parameters<typeof FightRow>[0]["quotes"];
}) {
  const perDay = new Map<string, number>();
  for (const d of all) {
    const { key } = etDay(finishedAt(d, now), now);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const groups: { key: string; label: string; rows: DuelView[] }[] = [];
  for (const d of visible) {
    const day = etDay(finishedAt(d, now), now);
    const last = groups[groups.length - 1];
    if (last && last.key === day.key) last.rows.push(d);
    else groups.push({ ...day, rows: [d] });
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="flex min-w-0 flex-col gap-2">
          <h2 className="micro flex items-center gap-3 text-dim">
            <span className="shrink-0">{g.label}</span>
            <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-line" />
            <span className="num shrink-0">{plural(perDay.get(g.key) ?? g.rows.length, "fight", "fights")}</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {g.rows.map((d) => (
              <li key={d.address.toBase58()} className="min-w-0">
                <FightRow d={d} now={now} quotes={quotes} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* An empty tab says which tab is empty and where to go. When it is the
 * filters that emptied it, it says that, with the count they are hiding,
 * instead of implying the chain is quiet. */
function TabEmpty({
  tab,
  filtered,
  unfiltered,
  bell,
  now,
  hrefWith,
  onClear,
}: {
  tab: TabId;
  filtered: boolean;
  /** How many fights this tab holds with no filters on (test fights as the URL says). */
  unfiltered: number;
  bell: number;
  now: number;
  hrefWith: (patch: Record<string, string | null>) => string;
  onClear: () => void;
}) {
  const title: Record<TabId, string> = {
    live: "Nothing live right now.",
    open: "No open challenges.",
    final: "No settled fights yet.",
    mine: "No fights on chain for this wallet yet.",
    called: "Nobody has called you out.",
  };
  if (filtered && unfiltered > 0) {
    return (
      <Empty
        title="Nothing here matches."
        body={`${TAB_LABEL[tab]} has ${plural(unfiltered, "fight", "fights")} without these filters.`}
        action={
          <button type="button" className="btn btn-sm btn-light" onClick={onClear}>
            Clear filters
          </button>
        }
      />
    );
  }
  switch (tab) {
    case "live":
      return (
        <Empty
          title={title.live}
          body={bell ? `Last bell ${ago(bell, now)}.` : undefined}
          action={{ href: hrefWith({ tab: "open" }), label: "See open challenges", tone: "light" }}
        />
      );
    case "open":
    case "mine":
      return <Empty title={title[tab]} action={{ href: "/new", label: "Pick a fight", tone: "p1" }} />;
    case "called":
      return <Empty title={title.called} body="A challenge made for your wallet lands here." />;
    default:
      return <Empty title={title.final} action={{ href: hrefWith({ tab: "open" }), label: "See open challenges" }} />;
  }
}

/* THE FILTER PANEL: type a stock, an @handle or a wallet, or tap one of the
 * stocks and fighters actually on this tab, counted from the list itself. */
function FilterPanel({
  stocks,
  fighters,
  ticker,
  wallet,
  handles,
  scope,
  hiddenTests,
  onTicker,
  onWallet,
  onShowTests,
}: {
  stocks: { ticker: string; n: number }[];
  fighters: { wallet: string; n: number }[];
  ticker: string | null;
  wallet: string | null;
  handles: Record<string, string> | undefined;
  scope: string;
  hiddenTests: number;
  onTicker: (ticker: string | null) => void;
  onWallet: (wallet: string | null) => void;
  onShowTests: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [miss, setMiss] = useState<string | null>(null);

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const q = text.trim().replace(/^\$/, "");
    if (!q) return;
    const up = q.toUpperCase();
    // "NVDAx" is how the token is named; the stock is NVDA.
    const stock = byTicker(up) ?? (q.endsWith("x") ? byTicker(up.slice(0, -1)) : undefined);
    if (stock) {
      onTicker(stock.ticker);
      setText("");
      setMiss(null);
      return;
    }
    const handle = q.replace(/^@/, "").toLowerCase();
    const byHandle = Object.entries(handles ?? {}).find(([, h]) => h.toLowerCase() === handle)?.[0];
    let key: string | null = byHandle ?? null;
    if (!key && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) {
      try {
        key = new PublicKey(q).toBase58();
      } catch {
        key = null;
      }
    }
    if (key) {
      onWallet(key);
      setText("");
      setMiss(null);
      return;
    }
    setMiss("No listed stock, linked @handle or wallet address matches that.");
  };

  return (
    <Plate pad="std" className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-2">
        <label htmlFor={`${id}-q`} className="label">
          Find a stock or fighter
        </label>
        <div className="flex min-w-0 gap-2">
          <input
            id={`${id}-q`}
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMiss(null);
            }}
            /* Enter submits here rather than leaning on the browser's implicit
             * submission, which some embedded and assistive browsers skip for
             * a search field. preventDefault stops the second, native one. */
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submit(e);
            }}
            placeholder="NVDA, @handle or a wallet"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={miss ? true : undefined}
            aria-describedby={miss ? `${id}-miss` : undefined}
            className="input min-w-0 flex-1 py-2 text-sm"
          />
          <button type="submit" className="btn btn-sm btn-ghost shrink-0">
            Find
          </button>
        </div>
        {miss ? (
          <p id={`${id}-miss`} className="text-meta text-dim" role="status">
            {miss}
          </p>
        ) : null}
      </form>

      {stocks.length ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="label">Stocks in {scope} fights</p>
          <div className="flex flex-wrap gap-1">
            {stocks.map((s) => {
              const on = ticker === s.ticker;
              return (
                <button
                  key={s.ticker}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onTicker(on ? null : s.ticker)}
                  className={cx("btn btn-sm", on ? "btn-light" : "btn-ghost")}
                >
                  <span className="normal-case">{s.ticker}</span>
                  <span className={cx("micro num", on ? "text-void" : "text-dim")}>{s.n}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {fighters.length ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="label">Fighters in {scope} fights</p>
          <ul className="flex flex-col">
            {fighters.map((f) => {
              const on = wallet === f.wallet;
              return (
                <li key={f.wallet} className="min-w-0 border-t border-line first:border-t-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onWallet(on ? null : f.wallet)}
                    className={cx(
                      "row flex h-10 w-full min-w-0 items-center justify-between gap-3 px-2 text-left focus-visible:-outline-offset-2 sm:h-9",
                      on && "bg-panel-3 shadow-[inset_2px_0_0_var(--color-ink)]",
                    )}
                  >
                    <FighterName wallet={f.wallet} size="sm" href={null} />
                    <span className="num shrink-0 text-meta text-dim">{plural(f.n, "fight", "fights")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hiddenTests > 0 ? (
        <button
          type="button"
          onClick={onShowTests}
          className="self-start text-meta text-dim underline decoration-line-strong underline-offset-4 hover:text-ink"
        >
          Show {plural(hiddenTests, "test-token fight", "test-token fights")}
        </button>
      ) : null}
    </Plate>
  );
}
