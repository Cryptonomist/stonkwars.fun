"use client";

/* EXHIBITION BOUTS.
 *
 * A private company cannot be staked here. Its mint carries a permanent
 * delegate, a pause switch and a transfer fee the issuer sets, so a program
 * whose whole promise is that nobody can touch a stake cannot hold one
 * (lib/prestocks.ts). That left a desk of companies to look at and nothing to
 * do with them.
 *
 * This is the thing to do with them. Two sides, one window, the bigger
 * percentage move wins, and nothing is escrowed because there is nothing to
 * escrow. Boxing already had the word: an exhibition is a real bout that does
 * not go on the record.
 *
 * WHAT THIS PAGE MUST KEEP SAYING. The prices are real and the result is not.
 * No program runs, no stake moves, no receipt is written, and a win here counts
 * for nothing. NOTHING_AT_STAKE carries those words and a test asserts them, so
 * the promise and the page cannot drift apart. */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { pct, usd } from "@/lib/format";
import {
  movePct,
  NOTHING_AT_STAKE,
  verdictWords,
  WINDOWS,
  type Exhibition,
  type Leg,
  type WindowId,
} from "@/lib/exhibition";
import { poolLink, PRESTOCKS } from "@/lib/prestocks";
import { STAKEABLE } from "@/lib/stocks";

/* The listed side of the card. Every roster stock would be a thousand-long
 * menu, so this offers the ones people reach for, which are the same pairs the
 * sparring wallet opens seats on. */
const CHALLENGERS = ["NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "COIN", "MSTR", "PLTR", "SPY", "QQQ"];

export function ExhibitionDesk({ initialA, initialB }: { initialA?: string; initialB?: string }) {
  const listed = CHALLENGERS.filter((t) => STAKEABLE.some((s) => s.ticker === t));
  const [a, setA] = useState(() => (PRESTOCKS.some((p) => p.ticker === initialA) ? initialA! : "OPENAI"));
  const [b, setB] = useState(() => (initialB && [...listed, ...PRESTOCKS.map((p) => p.ticker)].includes(initialB) ? initialB : "NVDA"));
  const [w, setW] = useState<WindowId>("24h");

  const q = useQuery<Exhibition | { error: string }>({
    queryKey: ["exhibition", a, b, w],
    queryFn: async () => {
      const r = await fetch(`/api/exhibition?a=${a}&b=${b}&w=${w}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const data = q.data && !("error" in q.data) ? q.data : null;
  const failed = q.data && "error" in q.data ? q.data.error : q.isError ? "Could not read a market." : null;

  return (
    <div className="flex flex-col gap-6 py-6">
      <Plate as="header" notch pad="std" className="flex flex-col gap-3">
        <p className="label">Exhibition</p>
        <h1 className="display text-hud-lg text-ink">Let the private ones fight</h1>
        <p className="max-w-prose text-sm text-dim">
          OpenAI cannot be staked, so it has never been in the ring. Put it against a listed stock over the same window
          and see who would have won. Real prices, no stake, nothing on chain.
        </p>
      </Plate>

      <Plate as="section" pad="std" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
          <Picker label="Private company" value={a} onChange={setA} options={PRESTOCKS.map((p) => [p.ticker, p.name])} tone="p1" />
          <span className="display self-center text-center text-hud-sm text-dim">VS</span>
          <Picker
            label="Anyone on the board"
            value={b}
            onChange={setB}
            options={[
              ...listed.map((t) => [t, t] as [string, string]),
              ...PRESTOCKS.filter((p) => p.ticker !== a).map((p) => [p.ticker, p.name] as [string, string]),
            ]}
            tone="p2"
          />
        </div>
        <Tabs
          ariaLabel="How long the bout runs"
          size="sm"
          value={w}
          onChange={(id) => setW(id as WindowId)}
          items={(Object.keys(WINDOWS) as WindowId[]).map((id) => ({ id, label: WINDOWS[id].label }))}
        />
      </Plate>

      {failed ? (
        <Notice tone="warn" title="No bout right now.">
          {failed}
        </Notice>
      ) : null}

      <Plate as="section" pad="std" className="flex flex-col gap-5" aria-labelledby="bout">
        <SectionHead id="bout" title="The bout" count={data ? WINDOWS[w].label : null} />
        {q.isLoading || (!data && !failed) ? (
          <Skeleton className="h-64 w-full" />
        ) : data ? (
          <>
            <p className="display text-hud-sm text-ink">{verdictWords(data.verdict)}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Side leg={data.a} tone="p1" />
              <Side leg={data.b} tone="p2" />
            </div>
            <Race a={data.a} b={data.b} />
          </>
        ) : null}
      </Plate>

      <Notice title="Nothing is at stake here.">
        {NOTHING_AT_STAKE}{" "}
        <Link href="/how" className="link">
          How a real fight works
        </Link>
      </Notice>
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
  tone,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  tone: "p1" | "p2";
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="label text-dim">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "min-h-11 w-full rounded-sm border border-line bg-panel-2 px-3 text-base",
          tone === "p1" ? "text-p1" : "text-p2",
        )}
      >
        {options.map(([v, name]) => (
          <option key={v} value={v} className="text-ink">
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Side({ leg, tone }: { leg: Leg; tone: "p1" | "p2" }) {
  const move = movePct(leg.first, leg.last);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className={cx("display text-hud-sm", tone === "p1" ? "text-p1" : "text-p2")}>{leg.ticker}</span>
        {/* Name the venue rather than calling every pool the same thing: these
            are not all on one DEX, and the one it read is worth linking to. */}
        {leg.source === "pool" && leg.pool ? (
          <a href={poolLink(leg.pool)} target="_blank" rel="noreferrer" className="link text-meta">
            <Badge variant="source">{leg.venue ? `${leg.venue} pool` : "Solana pool"}</Badge>
          </a>
        ) : (
          <Badge variant="source">{leg.source === "pool" ? "Solana pool" : "Exchange"}</Badge>
        )}
      </p>
      <p className="num text-num-lg text-ink">{move === null ? "no trades" : pct(move, 3)}</p>
      <p className="text-meta text-dim">
        {leg.first === null || leg.last === null ? (
          "Nothing traded in this window."
        ) : (
          <>
            {usd(leg.first, { cents: true })} to {usd(leg.last, { cents: true })}
          </>
        )}
      </p>
    </div>
  );
}

/* THE RACE, drawn from each side's percent rather than its price.
 *
 * Two assets hundreds of dollars apart share no axis until both are measured
 * from their own start, which is also exactly how a real fight is judged: the
 * bigger percentage move, not the bigger number. */
function Race({ a, b }: { a: Leg; b: Leg }) {
  const pts = [...a.pct, ...b.pct].filter((x): x is number => x !== null);
  if (pts.length < 2) return null;
  const hi = Math.max(...pts, 0.01);
  const lo = Math.min(...pts, -0.01);
  const span = hi - lo || 1;
  const W = 720;
  const H = 200;

  const path = (leg: Leg) => {
    const n = leg.pct.length;
    if (!n) return "";
    let d = "";
    let started = false;
    leg.pct.forEach((v, i) => {
      if (v === null) return;
      const x = (i / Math.max(n - 1, 1)) * W;
      const y = H - ((v - lo) / span) * H;
      d += `${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      started = true;
    });
    return d;
  };

  const zero = H - ((0 - lo) / span) * H;
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label={`${a.ticker} against ${b.ticker}`}>
        <line x1="0" y1={zero} x2={W} y2={zero} stroke="currentColor" className="text-line" strokeDasharray="4 4" />
        <path d={path(a)} fill="none" strokeWidth="2.5" className="text-p1" stroke="currentColor" />
        <path d={path(b)} fill="none" strokeWidth="2.5" className="text-p2" stroke="currentColor" />
      </svg>
      <figcaption className="text-meta text-dim">
        Percent from each side&apos;s own first price in the window. Drawn from market bars, for watching: no result here
        is posted or checked anywhere.
      </figcaption>
    </figure>
  );
}
