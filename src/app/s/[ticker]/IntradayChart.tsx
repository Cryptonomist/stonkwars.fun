"use client";

/* A STOCK'S PRICE, BAR BY BAR.
 *
 * From /api/bars: the exchange's bars while it trades (pre-market and
 * after-hours included), and the stock's perp once it shuts, over a window the
 * reader picks (chart.ts TIMEFRAMES).
 *
 * As a line, its colour is the day's move: green when the last bar is at or
 * above the previous session's close and red when below, so it always agrees
 * with the "% today" in the page's header (with no close to hand, it falls back
 * to the window's first bar against its last). As candles, each bar is coloured
 * against its own open, the way a candle always is. The dashed line is that
 * previous close, from the live quote, the number today's move is measured
 * against.
 *
 * Under the price, what traded in each bar, on its own scale. Shares while the
 * exchange has it and contracts once the perp does, which are different things
 * counted differently, so the pane says which and the two never add up into one
 * number.
 *
 * WHAT IT DOES NOT DRAW. A stretch with no bars (a stock with no perp while
 * its exchange is shut, or half an hour nobody traded) breaks the line rather
 * than joining the two sides with a price that never traded, and when the
 * route says why there are no bars, the caption says it too. Where the market
 * changes hands, at 8:00 PM ET from the exchange to the perp, a faint marker
 * names the market the line comes from after it.
 *
 * The window ends at the whole minute, so every viewer asks for the same range
 * in a given minute and the edge can answer from cache. It is asked again each
 * minute.
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
import {
  DEFAULT_TIMEFRAME,
  fibLevels,
  hasVolume,
  sma,
  TIMEFRAMES,
  timeframeOf,
  volumeWords,
  vwap,
  type Timeframe,
  type TimeframeId,
} from "@/lib/chart";
import { etTime, pct, usd } from "@/lib/format";
import { nyParts, session } from "@/lib/market";

/** A stretch of this many bars with nothing traded is a gap, not a quiet minute. */
const GAP_BARS = 30;
const PAD = { top: 20, right: 72, bottom: 24, left: 8 };
/** The volume pane under the price, and the gap that keeps the two apart. */
const VOL_H = 40;
const VOL_GAP = 10;

type Src = "exchange" | "perp";
type Mode = "line" | "candles";
type Cols = { t?: number[]; c?: number[]; o?: number[]; h?: number[]; l?: number[]; v?: (number | null)[] };
type BarsBody = Cols & { src?: Src[]; note?: string; error?: string };
type Bars = {
  from: number;
  to: number;
  t: number[];
  c: number[];
  o: number[];
  h: number[];
  l: number[];
  v: (number | null)[];
  src: Src[];
  note?: string;
};

/* A bar's market in the words the live price badge uses: the exchange's bars
 * are "Exchange" in the regular session and "Extended hours" before and after
 * it, and the perp's are "Perp". */
const srcWords = (src: Src | undefined, sec: number) =>
  src === "perp" ? "Perp" : session(sec * 1_000) === "open" ? "Exchange" : "Extended hours";

function useBars(ticker: string, tf: Timeframe, enabled: boolean) {
  return useQuery<Bars>({
    queryKey: ["stock-bars", ticker, tf.id],
    enabled,
    queryFn: async () => {
      const to = Math.floor(Date.now() / 60_000) * 60;
      const from = to - tf.secs;
      const r = await fetch(`/api/bars?t=${encodeURIComponent(ticker)}&from=${from}&to=${to}&step=${tf.step}`);
      const body = (await r.json().catch(() => ({}))) as BarsBody;
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      const n = Math.min(body.t?.length ?? 0, body.c?.length ?? 0);
      const c = (body.c ?? []).slice(0, n);
      /* An older edge still serving the route before it carried candles gives
       * closes and nothing else, so each missing column is the close. */
      const priced = (col: number[] | undefined) =>
        col && col.length >= n ? col.slice(0, n) : c.slice();
      return {
        from,
        to,
        t: (body.t ?? []).slice(0, n),
        c,
        o: priced(body.o),
        h: priced(body.h),
        l: priced(body.l),
        v: body.v && body.v.length >= n ? body.v.slice(0, n) : new Array<number | null>(n).fill(null),
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
  const [tfId, setTfId] = useState<TimeframeId>(DEFAULT_TIMEFRAME);
  const tf = timeframeOf(tfId);
  /* How the price is drawn, and three overlays, all from what is on screen and
   * none an input to anything: the retracement levels of the window's own
   * range, a moving average over its bars, and the volume-weighted average
   * price since the window began. */
  const [mode, setMode] = useState<Mode>("line");
  const [showFib, setShowFib] = useState(false);
  const [showMa, setShowMa] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const bars = useBars(ticker, tf, charted);
  const steppedOut = useRef(false);
  useEffect(() => {
    if (steppedOut.current || !bars.data) return;
    steppedOut.current = true;
    if (tfId === DEFAULT_TIMEFRAME && bars.data.t.length === 0) setTfId("1W");
  }, [bars.data, tfId]);
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
      <Notice title="No chart for this listing.">
        Bars are drawn for US listings only. The live price above still comes from its own market.
      </Notice>
    );
  } else if (bars.isError && !bars.data) {
    body = (
      <Notice
        tone="error"
        title="Bars are unavailable right now."
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
          <Chart
            ticker={ticker}
            bars={bars.data}
            prevClose={prevClose}
            width={width}
            tf={tf}
            mode={mode}
            fib={showFib}
            ma={showMa}
            vwapOn={showVwap}
          />
        ) : (
          <div className="h-50 sm:h-60" />
        )}
      </div>
    );
  }

  const chip = (on: boolean) => cx("btn btn-sm px-2", on ? "btn-light" : "btn-ghost");

  /* What the window itself did, first bar to last. Separate from the "% today"
   * in the page's header, which is always measured on the previous close: over
   * a month those are different questions, and the chips say which window this
   * one answers for. */
  const c = bars.data?.c ?? [];
  const change = c.length > 1 && c[0] > 0 ? ((c[c.length - 1] - c[0]) / c[0]) * 100 : null;
  const anyVolume = hasVolume(bars.data?.v ?? []);

  return (
    <Plate as="section" pad="std" className={cx("flex flex-col gap-3", className)} aria-labelledby="intraday-title">
      <SectionHead id="intraday-title" title={`${ticker} price`} count={`${tf.barWords} · ET`} />
      {charted ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="group" aria-label="Timeframe" className="flex flex-wrap gap-1">
            {TIMEFRAMES.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={f.id === tfId}
                onClick={() => setTfId(f.id)}
                className={chip(f.id === tfId)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Draw the price as" className="flex flex-wrap gap-1">
            {(["line", "candles"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={chip(mode === m)}
              >
                {m === "line" ? "Line" : "Candles"}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Overlays" className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={showFib}
              onClick={() => setShowFib((v) => !v)}
              title="Fibonacci retracements of this window's high and low"
              className={chip(showFib)}
            >
              Fib
            </button>
            <button
              type="button"
              aria-pressed={showMa}
              onClick={() => setShowMa((v) => !v)}
              title={`Moving average of the last ${tf.maLen} bars`}
              className={chip(showMa)}
            >
              MA {tf.maLen}
            </button>
            <button
              type="button"
              aria-pressed={showVwap}
              onClick={() => setShowVwap((v) => !v)}
              title="Volume-weighted average price since this window began"
              className={chip(showVwap)}
            >
              VWAP
            </button>
          </div>
          {change !== null ? (
            <p className="ms-auto text-meta text-dim">
              <span className="uppercase">{tf.label}</span>{" "}
              <span className={cx("num", change > 0 ? "text-up" : change < 0 ? "text-down" : "text-dim")}>
                {pct(change)}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      {body}
      {charted ? (
        <div className="flex flex-col gap-1 text-meta text-dim">
          <p>
            {/* A daily bar covers whole sessions, so the route serves it from the
              * exchange alone; only the intraday sizes reach for the perp. */}
            {tf.step >= 86_400
              ? `${tf.barWords} from the exchange.`
              : `${tf.barWords} from the exchange, extended hours, and the perp when the exchange is shut.`}{" "}
            For watching; no line here decides a fight.
          </p>
          {showFib ? <p>Fib levels run from this window&apos;s high (0%) to its low (100%). They move as the window does.</p> : null}
          {showVwap ? (
            <p>VWAP is the average price weighted by what traded, counted from the left edge of this window.</p>
          ) : null}
          {anyVolume ? (
            <p>
              Volume is shares while the exchange has the stock and contracts once the perp does. Two different things
              counted two different ways, so each market is drawn against its own busiest bar and the two are never
              added up or compared across the handover.
            </p>
          ) : null}
          {bars.data?.note ? <p>{bars.data.note}</p> : null}
        </div>
      ) : null}
    </Plate>
  );
}

function Chart({
  ticker,
  bars,
  prevClose,
  width,
  tf,
  mode,
  fib,
  ma,
  vwapOn,
}: {
  ticker: string;
  bars: Bars;
  prevClose: number | null;
  width: number;
  tf: Timeframe;
  mode: Mode;
  fib: boolean;
  ma: boolean;
  vwapOn: boolean;
}) {
  const { from, to, t, c, o, h, l, v, src } = bars;
  const n = t.length;
  const clipId = useId();
  const liveId = useId();

  /* The volume pane exists only when a market said what traded. A stock whose
   * bars carry no size gets the plot it always had rather than an empty strip
   * along the bottom. */
  const showVol = hasVolume(v);
  const candles = mode === "candles";

  const height = (width < 480 ? 200 : 240) + (showVol ? VOL_H + VOL_GAP : 0);
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const priceH = plotH - (showVol ? VOL_H + VOL_GAP : 0);

  /* ── Scales ─────────────────────────────────────────────────────────── */
  /* Candles reach to each bar's own high and low, a line only to its close, so
   * the scale covers exactly what is drawn and no candle is clipped. */
  const tops = candles ? h : c;
  const bottoms = candles ? l : c;
  let lo = Infinity;
  let hi = -Infinity;
  for (const val of bottoms) if (val < lo) lo = val;
  for (const val of tops) if (val > hi) hi = val;
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
  const y = (val: number) => PAD.top + (1 - (val - y0) / (y1 - y0)) * priceH;

  /* One bar's share of the axis, taken from the window and the bar size rather
   * than the number of bars, so a candle keeps its width across a stretch
   * nothing traded in. Capped so a twenty-bar month does not draw slabs. */
  const slotW = plotW / Math.max(1, (to - from) / tf.step);
  const barW = Math.max(1, Math.min(13, slotW * 0.72));

  /* ── The volume pane ────────────────────────────────────────────────── */
  /* EACH MARKET AGAINST ITS OWN BUSIEST BAR.
   *
   * Shares and contracts are not the same unit and not the same size: a day of
   * TSLA peaked at 2,022,902 shares in a five-minute bar on the exchange and at
   * 417 contracts on the perp. On one shared scale the perp's whole night is a
   * flat line one pixel high, which reads as "nothing traded" when plenty did.
   * So each market is drawn against its own maximum. The two are never meant to
   * be compared across the handover, which is exactly what the caption says. */
  const volBase = PAD.top + plotH;
  const volMax: Record<Src, number> = { exchange: 0, perp: 0 };
  for (let i = 0; i < n; i++) {
    const size = v[i];
    if (size != null && size > volMax[src[i] ?? "exchange"]) volMax[src[i] ?? "exchange"] = size;
  }
  const vy = (i: number, size: number) => {
    const top = volMax[src[i] ?? "exchange"];
    return volBase - (top > 0 ? (size / top) * VOL_H : 0);
  };
  /* The gutter prices the market at the right edge, which is the one whose bars
   * are under it. */
  const volEdge = n ? volMax[src[n - 1] ?? "exchange"] : 0;

  /* Gutter prices, in the order they matter: where the stock is now, then the
   * previous close, then the window's own high and low. Each is dropped when it
   * would print on top of one already placed, so the newest never loses its
   * spot to a number that has not moved all day. */
  const gutter: { key: string; v: number; y: number }[] = [];
  if (n) {
    const candidates = [
      { key: "last", v: c[n - 1] },
      ...(prevClose !== null ? [{ key: "prev", v: prevClose }] : []),
      { key: "high", v: Math.max(...tops) },
      { key: "low", v: Math.min(...bottoms) },
    ];
    for (const g of candidates) {
      const gy = y(g.v);
      if (gutter.every((p) => Math.abs(p.y - gy) >= 12)) gutter.push({ ...g, y: gy });
    }
  }

  /* ── The line, broken at gaps ───────────────────────────────────────── */
  const gapSecs = GAP_BARS * tf.step;
  let d = "";
  for (let i = 0; i < n; i++) {
    const move = i === 0 || t[i] - t[i - 1] > gapSecs ? "M" : "L";
    d += `${move}${x(t[i]).toFixed(1)},${y(c[i]).toFixed(1)}`;
  }

  /* ── The overlays, all from the bars on screen ──────────────────────── */
  const levels = fib && n > 1 ? fibLevels(Math.max(...tops), Math.min(...bottoms)) : [];
  /* The moving average follows closes; VWAP weighs each bar by what traded in
   * it, so it reads the true highs and lows whichever way the price is drawn. */
  const series = (values: (number | null)[]) => {
    let path = "";
    let last = -1;
    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      if (val === null) continue;
      const move = last < 0 || t[i] - t[last] > gapSecs ? "M" : "L";
      path += `${move}${x(t[i]).toFixed(1)},${y(val).toFixed(1)}`;
      last = i;
    }
    return path;
  };
  const maPath = ma && n > tf.maLen ? series(sma(c, tf.maLen)) : "";
  const vwapLine = vwapOn && showVol && n > 1 ? vwap(h, l, c, v) : [];
  const vwapPath = series(vwapLine);
  const vwapLast = vwapLine.length ? vwapLine[vwapLine.length - 1] : null;
  /* The day's move against the previous close, the same number the page's
   * headline prints. Measured from the first bar of the window, the line drew
   * green directly under "-2.77% today" whenever the stock had fallen before
   * the window began. The window's own ends are the fallback with no close. */
  const up = prevClose !== null && n > 0 ? c[n - 1] >= prevClose : n > 1 ? c[n - 1] >= c[0] : true;
  const tone = up ? "text-up" : "text-down";

  /* A lone bar between two gaps draws no segment, so every bar also gets a
   * dot when the line is that sparse. */
  const lonely = (i: number) => (i === 0 || t[i] - t[i - 1] > gapSecs) && (i === n - 1 || t[i + 1] - t[i] > gapSecs);

  /* ── Ticks, in New York time: hours on a short window, dates on a long one ── */
  const ticks: { sec: number; label: string }[] = [];
  const byDate = tf.tick >= 86_400;
  const every = Math.max(tf.tick, Math.ceil((to - from) / Math.max(2, Math.floor(plotW / 64)) / tf.tick) * tf.tick);
  for (let sec = Math.ceil(from / every) * every; sec <= to; sec += every) {
    const parts = nyParts(sec * 1_000);
    ticks.push({
      sec,
      label: byDate ? `${parts.m}/${parts.d}` : `${parts.hh % 12 || 12} ${parts.hh < 12 ? "AM" : "PM"}`,
    });
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

  /** Shares on an exchange, contracts on a perp. Never the two added together. */
  const sizeWords = (i: number) =>
    v[i] == null
      ? null
      : `${volumeWords(v[i]!)} ${
          src[i] === "perp" ? (v[i] === 1 ? "contract" : "contracts") : v[i] === 1 ? "share" : "shares"
        }`;

  const describe = (i: number) =>
    [
      `${etTime(t[i])}: ${usd(c[i])}`,
      prevClose ? `${pct(((c[i] - prevClose) / prevClose) * 100)} on the previous close` : null,
      candles ? `open ${usd(o[i])}, high ${usd(h[i])}, low ${usd(l[i])}` : null,
      sizeWords(i),
      srcWords(src[i], t[i]),
    ]
      .filter(Boolean)
      .join(", ");

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
      ? `${ticker} over ${tf.label}: ${usd(c[0])} at ${etTime(t[0])} to ${usd(c[n - 1])} at ${etTime(t[n - 1])}, high ${usd(Math.max(...tops))}, low ${usd(Math.min(...bottoms))}.`
      : `${ticker}: no bars in this window.`;

  const tipW = candles || showVol ? 200 : 176;
  const tipLeft = at !== null ? Math.min(Math.max(0, x(t[at]) - tipW / 2), width - tipW) : 0;

  return (
    <div
      ref={wrap}
      className="relative touch-pan-y select-none focus-visible:outline-offset-4"
      style={{ height }}
      tabIndex={n ? 0 : -1}
      role="group"
      aria-label={`${summary}${n ? " Use the arrow keys to read each bar." : ""}`}
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
        {gutter.map((g) =>
          /* Where it is now gets a tag in the day's colour, the way a live
            * chart always marks its last price. The rest are plain. */
          g.key === "last" ? (
            <g key={g.key} className={tone}>
              <rect x={PAD.left + plotW + 4} y={g.y - 8} width={PAD.right - 10} height={16} fill="currentColor" />
              <text x={PAD.left + plotW + 8} y={g.y + 4} className="num" fontSize={10} fill="var(--color-void)">
                {usd(g.v)}
              </text>
            </g>
          ) : (
            <text key={g.key} x={PAD.left + plotW + 8} y={g.y + 4} className="num fill-dim" fontSize={10}>
              {usd(g.v)}
            </text>
          ),
        )}

        {/* Hours, in New York time, under the plot. A label centred on a tick
          * at the plot's edge was cut by the SVG's own edge ("8 AM" read as
          * "3 AM" on a phone), so labels are held 16px inside, as RaceChart's are;
          * the tick mark itself stays where the hour is. */}
        {ticks.map((k) => (
          <g key={k.sec}>
            <line x1={x(k.sec)} x2={x(k.sec)} y1={PAD.top + plotH} y2={PAD.top + plotH + 4} stroke="var(--color-faint)" />
            <text
              x={Math.min(Math.max(x(k.sec), PAD.left + 16), PAD.left + plotW - 16)}
              y={height - 6}
              textAnchor="middle"
              className="num fill-dim"
              fontSize={10}
            >
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

        {/* Fibonacci retracements of the window's own range, under the line. */}
        {levels.map((l) => (
          <g key={l.ratio}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(l.price)}
              y2={y(l.price)}
              stroke={l.major ? "var(--color-p1)" : "var(--color-line-strong)"}
              strokeOpacity={l.major ? 0.55 : 0.8}
              strokeDasharray="3 5"
            />
            {/* 0% and 100% sit exactly on the window's high and low, which the
              * gutter already prices, so only the levels between them are named. */}
            {l.ratio === 0 || l.ratio === 1 ? null : (
              <text x={PAD.left + plotW + 8} y={y(l.price) + 4} className="num fill-faint" fontSize={9}>
                {l.label}
              </text>
            )}
          </g>
        ))}

        <g clipPath={`url(#${clipId})`} className={tone}>
          {maPath ? (
            <path
              d={maPath}
              fill="none"
              stroke="var(--color-dim)"
              strokeWidth={1}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {vwapPath ? (
            <path
              d={vwapPath}
              fill="none"
              stroke="var(--color-cooked)"
              strokeWidth={1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {/* Candles are coloured against their own open, the way a candle
            * always is, and the line against the day. */}
          {candles ? (
            t.map((sec, i) => {
              const px = x(sec);
              const rising = c[i] >= o[i];
              const paint = rising ? "var(--color-up)" : "var(--color-down)";
              const bodyTop = y(Math.max(o[i], c[i]));
              const bodyBottom = y(Math.min(o[i], c[i]));
              return (
                <g key={sec}>
                  <line x1={px} x2={px} y1={y(h[i])} y2={y(l[i])} stroke={paint} strokeWidth={1} />
                  <rect
                    x={px - barW / 2}
                    y={bodyTop}
                    width={barW}
                    height={Math.max(1, bodyBottom - bodyTop)}
                    fill={paint}
                  />
                </g>
              );
            })
          ) : (
            <>
              <path
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {t.map((sec, i) =>
                lonely(i) && i !== n - 1 ? (
                  <circle key={sec} cx={x(sec)} cy={y(c[i])} r={1.5} fill="currentColor" />
                ) : null,
              )}
              {n ? <circle cx={x(t[n - 1])} cy={y(c[n - 1])} r={3} fill="currentColor" /> : null}
            </>
          )}
        </g>

        {/* WHAT TRADED IN EACH BAR, on its own scale under the price. Shares
          * while the exchange has it, contracts once the perp does, which is
          * why the pane is only ever read against itself. */}
        {showVol ? (
          <g clipPath={`url(#${clipId})`}>
            {t.map((sec, i) => {
              const size = v[i];
              if (size == null || size <= 0) return null;
              const top = vy(i, size);
              return (
                <rect
                  key={sec}
                  x={x(sec) - barW / 2}
                  y={top}
                  width={barW}
                  height={Math.max(1, volBase - top)}
                  fill={c[i] >= o[i] ? "var(--color-up)" : "var(--color-down)"}
                  fillOpacity={0.4}
                />
              );
            })}
            <line x1={PAD.left} x2={PAD.left + plotW} y1={volBase} y2={volBase} stroke="var(--color-line)" />
          </g>
        ) : null}
        {showVol ? (
          <>
            <text x={PAD.left + 2} y={volBase - VOL_H + 8} className="fill-faint" fontSize={9}>
              Volume
            </text>
            <text x={PAD.left + plotW + 8} y={volBase - VOL_H + 8} className="num fill-faint" fontSize={9}>
              {volumeWords(volEdge)}
            </text>
          </>
        ) : null}

        {/* VWAP names itself over the end of its own line. Inside the plot, not
          * in the gutter, which is spoken for by the prices. */}
        {vwapPath && vwapLast !== null ? (
          <text
            x={PAD.left + plotW - 4}
            y={y(vwapLast) - 5}
            textAnchor="end"
            fontSize={9}
            fill="var(--color-cooked)"
          >
            VWAP
          </text>
        ) : null}

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
            {/* The crosshair's own price, over the gutter it sits in. */}
            <rect x={PAD.left + plotW + 4} y={y(c[at]) - 8} width={PAD.right - 10} height={16} fill="var(--color-ink)" />
            <text x={PAD.left + plotW + 8} y={y(c[at]) + 4} className="num" fontSize={10} fill="var(--color-void)">
              {usd(c[at])}
            </text>
          </g>
        ) : null}
      </svg>

      {n === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-dim">
          No bars in this window.
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
          {candles ? (
            <p className="num mt-0.5 flex flex-wrap justify-between gap-x-2 text-micro text-dim">
              <span>O {usd(o[at])}</span>
              <span>H {usd(h[at])}</span>
              <span>L {usd(l[at])}</span>
            </p>
          ) : null}
          {sizeWords(at) ? (
            <p className="mt-0.5 flex justify-between gap-2 text-micro text-dim">
              <span>Volume</span>
              <span className="num">{sizeWords(at)}</span>
            </p>
          ) : null}
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
