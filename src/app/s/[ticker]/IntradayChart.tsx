"use client";

/* A STOCK'S LAST SIX HOURS, MINUTE BY MINUTE.
 *
 * One line, from /api/bars: the exchange's minute bars while it trades
 * (pre-market and after-hours included), and the stock's perp once it shuts.
 * The line is green when the last bar is at or above the first and red when
 * below, because that is what the price did over the window; the only other
 * colour is the crosshair's move against the previous close. The dashed line is the previous session's close from
 * the live quote, the number today's move is measured against.
 *
 * WHAT IT DOES NOT DRAW. A stretch with no bars (a stock with no perp while
 * its exchange is shut, or half an hour nobody traded) breaks the line rather
 * than joining the two sides with a price that never traded, and when the
 * route says why there are no bars, the caption says it too. Where the market
 * changes hands, at 8:00 PM ET from the exchange to the perp, a faint marker
 * names the market the line comes from after it.
 *
 * The window is the last six hours to the whole minute, so every viewer asks
 * for the same range in a given minute and the edge can answer from cache.
 * It is asked again each minute.
 *
 * Plain SVG measured to its box, like the race chart, so text stays at its real
 * size on a phone. The crosshair follows a mouse or a finger (a finger keeps it
 * until the next tap elsewhere), and the arrow keys walk it bar by bar with the
 * time and price read out politely.
 *
 * FOR WATCHING. Nothing drawn here is an input to any fight. */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import { etTime, pct, usd } from "@/lib/format";
import { nyParts, session } from "@/lib/market";

const WINDOW_SECS = 6 * 3_600;
/** A stretch this long with no bar is a gap in trading, not a quiet minute. */
const GAP_SECS = 30 * 60;
const PAD = { top: 20, right: 72, bottom: 24, left: 8 };

type Src = "exchange" | "perp";
type BarsBody = { t?: number[]; c?: number[]; src?: Src[]; note?: string; error?: string };
type Bars = { from: number; to: number; t: number[]; c: number[]; src: Src[]; note?: string };

/* A bar's market in the words the live price badge uses: the exchange's bars
 * are "Exchange" in the regular session and "Extended hours" before and after
 * it, and the perp's are "Perp". */
const srcWords = (src: Src | undefined, sec: number) =>
  src === "perp" ? "Perp" : session(sec * 1_000) === "open" ? "Exchange" : "Extended hours";

function useSixHours(ticker: string, enabled: boolean) {
  return useQuery<Bars>({
    queryKey: ["stock-bars", ticker],
    enabled,
    queryFn: async () => {
      const to = Math.floor(Date.now() / 60_000) * 60;
      const from = to - WINDOW_SECS;
      const r = await fetch(`/api/bars?t=${encodeURIComponent(ticker)}&from=${from}&to=${to}`);
      const body = (await r.json().catch(() => ({}))) as BarsBody;
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      const n = Math.min(body.t?.length ?? 0, body.c?.length ?? 0);
      return {
        from,
        to,
        t: (body.t ?? []).slice(0, n),
        c: (body.c ?? []).slice(0, n),
        src: (body.src ?? []).slice(0, n),
        note: body.note,
      };
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function IntradayChart({
  ticker,
  prevClose,
  charted,
  className,
}: {
  ticker: string;
  /** The previous session's close from the live quote, when the source gave one. */
  prevClose: number | null;
  /** Minute bars exist for this listing (US only). */
  charted: boolean;
  className?: string;
}) {
  const bars = useSixHours(ticker, charted);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const hasBox = charted && !!bars.data;
  useEffect(() => {
    const el = box.current;
    if (!hasBox || !el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasBox]);

  let body;
  if (!charted) {
    body = (
      <Notice title="No minute chart for this listing.">
        Minute bars are drawn for US listings only. The live price above still comes from its own market.
      </Notice>
    );
  } else if (bars.isError && !bars.data) {
    body = (
      <Notice
        tone="error"
        title="Minute bars are unavailable right now."
        action={
          <button type="button" onClick={() => void bars.refetch()} className="btn btn-sm btn-ghost">
            Retry
          </button>
        }
      >
        The chart fills in when they return. The live price above is unaffected.
      </Notice>
    );
  } else if (!bars.data) {
    body = <Skeleton className="h-50 sm:h-60" />;
  } else {
    body = (
      <div ref={box} className="min-w-0">
        {width > 0 ? (
          <Chart ticker={ticker} bars={bars.data} prevClose={prevClose} width={width} />
        ) : (
          <div className="h-50 sm:h-60" />
        )}
      </div>
    );
  }

  return (
    <Plate as="section" pad="std" className={cx("flex flex-col gap-3", className)} aria-labelledby="intraday-title">
      <SectionHead id="intraday-title" title="Last 6 hours" count="1-minute bars · ET" />
      {body}
      {charted ? (
        <div className="flex flex-col gap-1 text-meta text-dim">
          <p>Minute bars from the exchange, extended hours, and the perp when the exchange is shut. For watching.</p>
          {bars.data?.note ? <p>{bars.data.note}</p> : null}
        </div>
      ) : null}
    </Plate>
  );
}

function Chart({ ticker, bars, prevClose, width }: { ticker: string; bars: Bars; prevClose: number | null; width: number }) {
  const height = width < 480 ? 200 : 240;
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const { from, to, t, c, src } = bars;
  const n = t.length;
  const clipId = useId();
  const liveId = useId();

  /* ── Scales ─────────────────────────────────────────────────────────── */
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of c) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (prevClose !== null && n > 0) {
    lo = Math.min(lo, prevClose);
    hi = Math.max(hi, prevClose);
  }
  if (n === 0) {
    lo = prevClose ?? 0;
    hi = prevClose ?? 1;
  }
  // Room above and below, and a real range for a price that did not move.
  const room = hi > lo ? (hi - lo) * 0.08 : Math.max(0.01, Math.abs(hi) * 0.002);
  const y0 = lo - room;
  const y1 = hi + room;

  const x = (sec: number) => PAD.left + ((Math.min(Math.max(sec, from), to) - from) / (to - from)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * plotH;

  /* Gutter prices: the previous close first, then the bars' own high and low,
   * each dropped when it would print on top of one already placed. */
  const gutter: { key: string; v: number; y: number }[] = [];
  if (n) {
    const candidates = [
      ...(prevClose !== null ? [{ key: "prev", v: prevClose }] : []),
      { key: "high", v: Math.max(...c) },
      { key: "low", v: Math.min(...c) },
    ];
    for (const g of candidates) {
      const gy = y(g.v);
      if (gutter.every((p) => Math.abs(p.y - gy) >= 12)) gutter.push({ ...g, y: gy });
    }
  }

  /* ── The line, broken at gaps ───────────────────────────────────────── */
  let d = "";
  for (let i = 0; i < n; i++) {
    const move = i === 0 || t[i] - t[i - 1] > GAP_SECS ? "M" : "L";
    d += `${move}${x(t[i]).toFixed(1)},${y(c[i]).toFixed(1)}`;
  }
  const up = n > 1 ? c[n - 1] >= c[0] : true;
  const tone = up ? "text-up" : "text-down";

  /* A lone bar between two gaps draws no segment, so every bar also gets a
   * dot when the line is that sparse. */
  const lonely = (i: number) => (i === 0 || t[i] - t[i - 1] > GAP_SECS) && (i === n - 1 || t[i + 1] - t[i] > GAP_SECS);

  /* ── Hour ticks, in New York time ───────────────────────────────────── */
  const ticks: { sec: number; label: string }[] = [];
  const everyOther = plotW / 6 < 56;
  for (let sec = Math.ceil(from / 3_600) * 3_600; sec <= to; sec += 3_600) {
    const hh = nyParts(sec * 1_000).hh;
    if (everyOther && hh % 2 === 1) continue;
    ticks.push({ sec, label: `${hh % 12 || 12} ${hh < 12 ? "AM" : "PM"}` });
  }

  /* ── Where the market changes hands ─────────────────────────────────── */
  const handovers: { sec: number; to: Src }[] = [];
  for (let i = 1; i < n; i++) if (src[i] && src[i - 1] && src[i] !== src[i - 1]) handovers.push({ sec: t[i], to: src[i] });

  /* ── Crosshair ──────────────────────────────────────────────────────── */
  const [hover, setHover] = useState<number | null>(null);
  const [spoken, setSpoken] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  // Keep the index valid when a refresh shortens or shifts the bars.
  const at = hover !== null && n > 0 ? Math.min(hover, n - 1) : null;

  const nearest = (sec: number) => {
    let a = 0;
    let b = n - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (t[m] < sec) a = m + 1;
      else b = m;
    }
    return a > 0 && Math.abs(t[a - 1] - sec) < Math.abs(t[a] - sec) ? a - 1 : a;
  };

  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < PAD.left || px > PAD.left + plotW) return setHover(null);
    setHover(nearest(from + ((px - PAD.left) / plotW) * (to - from)));
  };

  /* A finger lifting fires pointerleave, which would wipe the reading it just
   * asked for, so a touch keeps the crosshair until a tap somewhere else. */
  useEffect(() => {
    if (hover === null) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [hover]);

  const describe = (i: number) =>
    `${etTime(t[i])}: ${usd(c[i])}${prevClose ? `, ${pct(((c[i] - prevClose) / prevClose) * 100)} on the previous close` : ""}, ${srcWords(src[i], t[i])}`;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, (at ?? n) - 1);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, (at ?? n - 2) + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      setHover(null);
      return;
    } else return;
    e.preventDefault();
    setHover(next);
    setSpoken(describe(next));
  };

  const summary =
    n > 1
      ? `${ticker} over the last 6 hours: ${usd(c[0])} at ${etTime(t[0])} to ${usd(c[n - 1])} at ${etTime(t[n - 1])}, high ${usd(Math.max(...c))}, low ${usd(Math.min(...c))}.`
      : `${ticker}: no minute bars in the last 6 hours.`;

  const tipW = 176;
  const tipLeft = at !== null ? Math.min(Math.max(0, x(t[at]) - tipW / 2), width - tipW) : 0;

  return (
    <div
      ref={wrap}
      className="relative touch-pan-y select-none focus-visible:outline-offset-4"
      style={{ height }}
      tabIndex={n ? 0 : -1}
      role="group"
      aria-label={`${summary}${n ? " Use the arrow keys to read each minute." : ""}`}
      onPointerMove={onPoint}
      onPointerDown={onPoint}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHover(null);
      }}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} aria-hidden="true" className="block">
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left - 3} y={0} width={plotW + 6} height={height} />
          </clipPath>
        </defs>

        {/* The scale: the top and bottom of the plot, faint, with the window's
          * high, low and the previous close priced in the gutter. */}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={y(y1)} y2={y(y1)} stroke="var(--color-line)" />
        <line x1={PAD.left} x2={PAD.left + plotW} y1={y(y0)} y2={y(y0)} stroke="var(--color-line)" />
        {gutter.map((g) => (
          <text key={g.key} x={PAD.left + plotW + 8} y={g.y + 4} className="num fill-dim" fontSize={10}>
            {usd(g.v)}
          </text>
        ))}

        {/* Hours, in New York time, under the plot. */}
        {ticks.map((k) => (
          <g key={k.sec}>
            <line x1={x(k.sec)} x2={x(k.sec)} y1={PAD.top + plotH} y2={PAD.top + plotH + 4} stroke="var(--color-faint)" />
            <text x={x(k.sec)} y={height - 6} textAnchor="middle" className="num fill-dim" fontSize={10}>
              {k.label}
            </text>
          </g>
        ))}

        {/* The previous close, dashed, labelled at the right edge. */}
        {prevClose !== null && n ? (
          <>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(prevClose)}
              y2={y(prevClose)}
              stroke="var(--color-line-strong)"
              strokeDasharray="4 4"
            />
            <text x={PAD.left + 2} y={y(prevClose) - 4} className="fill-dim" fontSize={10}>
              Prev close
            </text>
          </>
        ) : null}

        {handovers.map((h) => (
          <g key={h.sec}>
            <line
              x1={x(h.sec)}
              x2={x(h.sec)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-faint)"
              strokeDasharray="2 3"
            />
            {/* Written after the marker, or before it when that would run off the plot. */}
            <text
              x={x(h.sec) > PAD.left + plotW - 96 ? x(h.sec) - 4 : x(h.sec) + 4}
              y={PAD.top - 8}
              textAnchor={x(h.sec) > PAD.left + plotW - 96 ? "end" : "start"}
              className="fill-dim"
              fontSize={10}
            >
              {srcWords(h.to, h.sec)} from here
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`} className={tone}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {t.map((sec, i) =>
            lonely(i) && i !== n - 1 ? <circle key={sec} cx={x(sec)} cy={y(c[i])} r={1.5} fill="currentColor" /> : null,
          )}
          {n ? <circle cx={x(t[n - 1])} cy={y(c[n - 1])} r={3} fill="currentColor" /> : null}
        </g>

        {at !== null ? (
          <g>
            <line
              x1={x(t[at])}
              x2={x(t[at])}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-ink)"
              strokeOpacity={0.5}
            />
            <circle cx={x(t[at])} cy={y(c[at])} r={3.5} fill="var(--color-ink)" stroke="var(--color-void)" strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>

      {n === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-dim">
          No minute bars in the last 6 hours.
        </p>
      ) : null}

      {at !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 bg-panel-2 px-2 py-1 text-meta shadow-overlay ring-1 ring-line-strong"
          style={{ left: tipLeft, width: tipW }}
          aria-hidden="true"
        >
          <p className="flex justify-between gap-2 text-dim">
            <span>{etTime(t[at])}</span>
            <span>{srcWords(src[at], t[at])}</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="num text-ink">{usd(c[at])}</span>
            {prevClose ? <MoveText value={((c[at] - prevClose) / prevClose) * 100} /> : null}
          </p>
        </div>
      ) : null}

      <span id={liveId} className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}

function MoveText({ value }: { value: number }) {
  return (
    <span className={cx("num", value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim")}>{pct(value)}</span>
  );
}
