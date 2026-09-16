"use client";

/* THE WIRE: every step a fight took, newest first, with its true age.
 *
 * A board of rows says what is true now; the wire says what just happened,
 * which is what makes a page feel live without inventing anything. Each line
 * is one timestamp the program wrote on a duel account (created, accepted,
 * started, ended) turned into a sentence by lib/derive fightEvents, so there
 * is no feed to fake and nothing to store: the same list every board polls is
 * the whole source.
 *
 * NEW MEANS NEW SINCE THE LAST POLL. The ids seen on the previous list are
 * kept, and a line whose id was not among them gets one faint ink tint. The
 * first list the page loads tints nothing, because everything on it is new to
 * the viewer and none of it happened just now. */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { Empty } from "@/components/ui/Empty";
import { FighterName } from "@/components/ui/FighterName";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { allDuels, type DuelView } from "@/lib/duel";
import { fightEvents, type FightEvent, type FightEventKind } from "@/lib/derive";
import { ago, points, shares, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { decimalsForMint, tokenSymbol } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

const SHOWN = 12;

export function Wire({ rows = SHOWN }: { rows?: number }) {
  const duels = useDuels("all", allDuels());
  const now = useNow();
  // A coarse clock for the event list: only "expired" depends on it, to the minute is plenty.
  const minute = Math.floor(now / 60) * 60;
  const events = useMemo(
    () => (duels.data && minute ? fightEvents(duels.data, minute).slice(0, rows) : []),
    [duels.data, minute, rows],
  );

  const fresh = useFresh(duels.data && minute ? events : null);
  const amounts = useMemo(() => stakesByFight(duels.data ?? []), [duels.data]);

  let body;
  if (duels.isLoading || (duels.data && !minute)) {
    body = <SkeletonRows kind="event" rows={8} />;
  } else if (duels.error && !duels.data) {
    body = (
      <Notice
        tone="error"
        title="Could not reach Solana."
        action={
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void duels.refetch()}>
            Retry
          </button>
        }
      >
        The wire picks up as soon as the chain answers.
      </Notice>
    );
  } else if (!events.length) {
    body = <Empty title="Nothing on the wire yet." action={{ href: "/new", label: "Pick a fight", tone: "p1" }} />;
  } else {
    body = (
      <Plate pad="none">
        {/* A container, so lines can drop their extras by the width the wire
          * actually has (a phone, or the middle column at 1280px) rather than
          * by the width of the window. */}
        <ol className="@container flex flex-col py-1" aria-label="Latest fight events, newest first">
          {events.map((e) => (
            <li key={e.id} className="h-9 border-t border-line first:border-t-0">
              <Link
                href={`/f/${e.address}`}
                className={cx(
                  "row flex h-full min-w-0 items-center gap-2 px-3 focus-visible:-outline-offset-2",
                  fresh.has(e.id) && "row-new",
                )}
              >
                <span className="micro num w-14 shrink-0 text-dim">{ago(e.at, now)}</span>
                <Glyph kind={e.kind} />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden whitespace-nowrap text-meta text-ink">
                  <Sentence e={e} />
                </span>
                <Figure e={e} amount={amounts.get(e.address)} />
              </Link>
            </li>
          ))}
        </ol>
      </Plate>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="wire-head">
      <SectionHead id="wire-head" title="The wire" />
      {body}
    </section>
  );
}

/* Ids on screen that were not on the previous list. The first list marks the
 * baseline and tints nothing. The set is state, not a ref read during render,
 * so a tinted line keeps its class until the next list replaces it, and a
 * re-render in between (the clock ticks every second) does not cut the tint
 * short or replay it. */
function useFresh(events: FightEvent[] | null): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const key = events ? events.map((e) => e.id).join("|") : null;

  useEffect(() => {
    if (key === null) return;
    const ids = key ? key.split("|") : [];
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    for (const id of ids) seen.current.add(id);
    setFresh((prev) => (added.length === 0 && prev.size === 0 ? prev : new Set(added)));
  }, [key]);

  return fresh;
}

type Stake = { raw: bigint; decimals: number };

/** The creator's stake per fight, for "0.11 NVDAx on the table". */
function stakesByFight(duels: DuelView[]): Map<string, Stake> {
  const out = new Map<string, Stake>();
  for (const d of duels) out.set(d.address.toBase58(), { raw: d.creatorAmount, decimals: decimalsForMint(d.creatorMint) });
  return out;
}

function T({ side, children }: { side: "p1" | "p2"; children: string }) {
  return (
    <span className={cx("display shrink-0 text-hud-xs normal-case", side === "p1" ? "text-p1-soft" : "text-p2-soft")}>{children}</span>
  );
}

/* "NVDA vs AAPL", each in its side's colour. `then` hangs punctuation off the
 * second ticker with no gap, so it reads "AAPL:" and not "AAPL :". */
const Vs = ({ e, then }: { e: FightEvent; then?: string }) => (
  <>
    <T side="p1">{e.t1}</T>
    <span className="shrink-0 text-dim">vs</span>
    <span className="inline-flex shrink-0 items-baseline">
      <T side="p2">{e.t2}</T>
      {then ? <span>{then}</span> : null}
    </span>
  </>
);

/* THE NUMBER STAYS ON SCREEN. A rail is narrow, and a sentence that runs out
 * of room truncates from its end, which is exactly where "took $25.00" was.
 * So the figure a line is about sits in its own right-hand column, fixed and
 * never truncated, and the words give way first: what went on the table when
 * a challenge opened, and what the winner took at the bell. */
function Figure({ e, amount }: { e: FightEvent; amount?: Stake }) {
  let figure: ReactNode = null;
  if (e.kind === "opened" && amount && amount.raw > BigInt(0)) {
    figure = (
      <span className="text-ink">
        {shares(amount.raw, amount.decimals)} {tokenSymbol(e.t1)}
        <span className="sr-only"> on the table</span>
      </span>
    );
  } else if (e.kind === "bell" && e.take) {
    figure = <span className="text-up">took {usd(e.take.usd)}</span>;
  }
  return figure ? <span className="num shrink-0 text-right text-meta whitespace-nowrap">{figure}</span> : null;
}

function Sentence({ e }: { e: FightEvent }) {
  switch (e.kind) {
    case "opened":
      return (
        <>
          <Vs e={e} />
          {/* Below a 24rem wire (a phone) the word was clipped to "opene": the
            * + glyph already says what kind of line this is, so the word gives
            * way whole, and a screen reader still hears it. */}
          <span className="hidden shrink-0 @sm:inline">opened</span>
          <span className="sr-only @sm:hidden">opened</span>
          {e.taunt ? (
            <span className="hidden min-w-0 truncate text-dim italic @md:inline">&ldquo;{e.taunt}&rdquo;</span>
          ) : null}
        </>
      );
    case "taken":
      return (
        <>
          {e.opponent ? (
            <span className="inline-flex min-w-0 shrink items-baseline self-center">
              <FighterName wallet={e.opponent} size="sm" href={null} />
            </span>
          ) : null}
          <span className="shrink-0">took it</span>
          <span className="shrink-0 text-dim">·</span>
          <Vs e={e} />
        </>
      );
    case "live":
      return (
        <>
          <span className="shrink-0">Round live:</span>
          <Vs e={e} />
        </>
      );
    case "bell": {
      const winner = e.winnerSide === "p2" ? { t: e.t2, side: "p2" as const } : { t: e.t1, side: "p1" as const };
      const loser = e.winnerSide === "p2" ? { t: e.t1, side: "p1" as const } : { t: e.t2, side: "p2" as const };
      return (
        <>
          <T side={winner.side}>{winner.t}</T>
          <span className="shrink-0">cooked</span>
          <T side={loser.side}>{loser.t}</T>
          {/* The margin is the first thing to go on a narrow wire: cut to
            * "by 0.0" it would be a different number, and the fight page has it. */}
          {e.margin !== undefined ? (
            <span className="num hidden shrink-0 text-dim @md:inline">by {points(e.margin)} pts</span>
          ) : null}
        </>
      );
    }
    case "heat":
      return (
        <>
          <Vs e={e} then=":" />
          <span className="min-w-0 truncate">dead heat. Both stakes home.</span>
        </>
      );
    case "void":
      return (
        <>
          <Vs e={e} />
          <span className="min-w-0 truncate">voided. Both stakes home.</span>
        </>
      );
    case "expired":
      return (
        <>
          <Vs e={e} />
          <span className="min-w-0 truncate text-dim">expired untaken.</span>
        </>
      );
  }
}

/* One small ink mark per kind, so a column of events can be scanned by shape
 * before it is read. Ink only: none of these is a side or a move. */
function Glyph({ kind }: { kind: FightEventKind }) {
  const common = {
    width: 10,
    height: 10,
    viewBox: "0 0 10 10",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true,
  } as const;
  let mark;
  switch (kind) {
    case "opened":
      mark = (
        <svg {...common}>
          <path d="M5 1.5v7M1.5 5h7" />
        </svg>
      );
      break;
    case "taken":
      mark = (
        <svg {...common}>
          <path d="M1.5 5.2 4 7.5l4.5-5" />
        </svg>
      );
      break;
    case "live":
      /* The split dot, held still: this line records that a round went live,
       * and a pulse on a round that ended an hour ago would be motion with
       * nothing happening behind it. */
      mark = <span className="h-1.5 w-1.5 rounded-full bg-[linear-gradient(90deg,var(--color-p1)_50%,var(--color-p2)_50%)]" />;
      break;
    case "bell":
      mark = (
        <svg {...common}>
          <path d="M2 7.5h6M3 7.5V4.5a2 2 0 0 1 4 0v3M4.3 9h1.4" />
        </svg>
      );
      break;
    case "heat":
      mark = (
        <svg {...common}>
          <path d="M1.5 3.5h7M1.5 6.5h7" />
        </svg>
      );
      break;
    case "void":
      mark = (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.3" />
          <path d="M2.5 7.5l5-5" />
        </svg>
      );
      break;
    case "expired":
      mark = (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.5" />
          <path d="M5 3v2.2l1.4 1" />
        </svg>
      );
      break;
  }
  return (
    <span
      className={cx(
        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-panel-3",
        kind === "expired" || kind === "void" ? "text-dim" : "text-ink",
      )}
      aria-hidden="true"
    >
      {mark}
    </span>
  );
}
