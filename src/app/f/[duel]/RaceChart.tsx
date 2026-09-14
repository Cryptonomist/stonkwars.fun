"use client";

/* THE RACE: both stocks as percent from their own on-chain start, on one chart.
 *
 * A fight is not which stock went up. It is which moved more from where it
 * started, so both lines begin at the same dashed zero ("Start"), and the
 * shaded gap between them is the thing being fought over, in the colour of
 * whoever holds it. A dashed bell marks the end of the round.
 *
 * Plain SVG, no chart library. It is measured to its box, so text stays at its
 * real size on a phone rather than being scaled with the drawing. The tips are
 * HTML dots laid over the SVG, because the ping ring (.tip-ping) is a box
 * shadow, which SVG does not draw, and they ring once when a point is added.
 *
 * THE CLOCK. Ticks along the bottom are New York time (hours on a long round,
 * quarter hours on an hour or less). A live round over an hour can be seen
 * whole or as its last 30 minutes, and below 480px the tip labels move out of
 * the right gutter into a legend row, so a phone keeps its plot.
 *
 * FOR WATCHING. The path is minute bars and polled prices; the result is the
 * chain's start and bell prices, and the two ends of a finished chart are
 * pinned to exactly those (lib/raceSeries.ts). The caption says so. */

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";

import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import { STATUS_LIVE, type DuelView } from "@/lib/duel";
import { etTime, pct } from "@/lib/format";
import { nyParts } from "@/lib/market";
import type { Quotes } from "@/lib/prices";
import { valueAt, yHalfRange, type PctPt } from "@/lib/raceSeries";
import { useRaceSeries } from "@/lib/useRaceSeries";

/* The right gutter holds each side's label at its tip. Below 480px wide it
 * cost the plot a third of a phone, so there the labels move into a legend
 * row above the chart and the gutter closes. The bottom holds the ET clock. */
const PAD = { top: 16, right: 104, bottom: 28, left: 12 };
const NARROW = 480;

type View = "round" | "recent";
const RECENT_SECS = 30 * 60;

/** Tick spacing for a span of time: about four to eight ticks, on the clock. */
function tickStep(spanSecs: number): number {
  if (spanSecs <= 45 * 60) return 5 * 60;
  if (spanSecs <= 3_600) return 15 * 60;
  if (spanSecs <= 3 * 3_600) return 30 * 60;
  return 3_600;
}

/** "4 PM" on the hour, "4:15" between, in New York time. */
function tickLabel(sec: number): string {
  const { hh, mm } = nyParts(sec * 1_000);
  const h = hh % 12 || 12;
  return mm === 0 ? `${h} ${hh < 12 ? "AM" : "PM"}` : `${h}:${String(mm).padStart(2, "0")}`;
}

export function RaceChart({
  d,
  t1,
  t2,
  quotes,
  now,
  className,
}: {
  d: DuelView;
  t1: string;
  t2: string;
  quotes?: Quotes;
  now: number;
  className?: string;
}) {
  const known1 = t1 !== "?" ? t1 : null;
  const known2 = t2 !== "?" ? t2 : null;
  const series = useRaceSeries(d, known1, known2, quotes, now);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  /* Measured, because the box only exists once there is a start to draw from. */
  const drawn = !!d.startTs && series !== null;
  useEffect(() => {
    const el = box.current;
    if (!drawn || !el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawn]);

  const [picked, setPicked] = useState<View | null>(null);

  // Hidden before the start: there is no start to race from.
  if (!d.startTs || !series) return null;

  const live = d.status === STATUS_LIVE && now < d.endTs;

  /* TWO VIEWS OF A LONG LIVE ROUND. Drawn start to bell, 27 minutes of a
   * four-hour round huddled in the left eighth of the plot. A round over an
   * hour can also show just its last 30 minutes, which is the default until a
   * quarter of the round has run, and the bell is then named at the right
   * edge instead of drawn. The whole round is one tap away. */
  const round = d.endTs - d.startTs;
  const zoomable = live && round > 3_600;
  const view: View = zoomable ? (picked ?? (now - d.startTs < round / 4 ? "recent" : "round")) : "round";
  const domain: [number, number] =
    view === "recent" ? [Math.max(d.startTs, now - RECENT_SECS), Math.max(now + 60, d.startTs + 120)] : series.domain;

  return (
    <Plate as="section" pad="std" className={cx("flex flex-col gap-3", className)} aria-labelledby="race-title">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <SectionHead id="race-title" title="The race" count="% from each on-chain start" className="min-w-0 flex-1" />
        {zoomable ? (
          <div role="group" aria-label="Chart range" className="flex shrink-0 gap-1">
            {(["round", "recent"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setPicked(v)}
                className={cx("btn btn-sm", view === v ? "btn-light" : "btn-ghost")}
              >
                {v === "round" ? "Round" : "Last 30 min"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div ref={box} className="relative min-w-0">
        {width > 0 ? (
          series.loading && series.p1.length <= 1 && series.p2.length <= 1 ? (
            <Skeleton className="h-60" />
          ) : (
            <Chart
              d={d}
              t1={t1}
              t2={t2}
              width={width}
              p1={series.p1}
              p2={series.p2}
              domain={domain}
              dashed={series.endpointsOnly}
              live={live}
            />
          )
        ) : (
          <div className="h-60" />
        )}
      </div>
      <div className="flex flex-col gap-1 text-meta text-dim">
        <p>Path from 1-minute market bars and live prices, for watching. The result uses only the on-chain start and bell prices.</p>
        {series.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </Plate>
  );
}

function Chart({
  d,
  t1,
  t2,
  width,
  p1: all1,
  p2: all2,
  domain,
  dashed,
  live,
}: {
  d: DuelView;
  t1: string;
  t2: string;
  width: number;
  p1: PctPt[];
  p2: PctPt[];
  domain: [number, number];
  dashed: boolean;
  live: boolean;
}) {
  const narrow = width < NARROW;
  const height = narrow ? 200 : 240;
  const clipId = useId();
  const [x0, x1] = domain;
  const padRight = narrow ? 12 : PAD.right;
  const plotW = Math.max(40, width - PAD.left - padRight);
  const plotH = height - PAD.top - PAD.bottom;

  /* Only what is inside the window is drawn and scaled, plus the one point
   * before it so the line enters from the left edge instead of starting in
   * mid-air; the clip path trims that point's overhang. */
  const inWindow = (s: PctPt[]) => {
    const first = s.findIndex((p) => p.t >= x0);
    if (first === -1) return s.length ? [s[s.length - 1]] : [];
    return s.slice(Math.max(0, first - 1)).filter((p) => p.t <= x1);
  };
  const p1 = inWindow(all1);
  const p2 = inWindow(all2);
  const half = yHalfRange([p1.filter((p) => p.t >= x0), p2.filter((p) => p.t >= x0)]);

  const xRaw = (t: number) => PAD.left + ((t - x0) / Math.max(1, x1 - x0)) * plotW;
  const x = (t: number) => xRaw(Math.min(Math.max(t, x0), x1));
  const y = (v: number) => PAD.top + (1 - (v + half) / (2 * half)) * plotH;

  const path = (s: PctPt[]) => s.map((p, i) => `${i ? "L" : "M"}${xRaw(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");

  /* The clock along the bottom, in ET: hours on a long round, quarter hours
   * on an hour or less, thinned when the ticks would crowd. */
  const step = tickStep(x1 - x0);
  const ticks: number[] = [];
  for (let s = Math.ceil(x0 / step) * step; s <= x1; s += step) ticks.push(s);
  const thin = ticks.length > 1 && plotW / ticks.length < 56;
  const shownTicks = thin ? ticks.filter((_, i) => i % 2 === 0) : ticks;

  const last1 = p1[p1.length - 1];
  const last2 = p2[p2.length - 1];
  const lead: "p1" | "p2" | null = last1 && last2 ? (last1.v > last2.v ? "p1" : last2.v > last1.v ? "p2" : null) : null;

  /* The gap: along one line and back along the other. */
  const area =
    p1.length > 1 && p2.length > 1 && lead
      ? `${path(p1)}${[...p2].reverse().map((p) => `L${xRaw(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}Z`
      : null;

  /* Right-edge labels, pushed apart when the two tips sit close. */
  const MIN_GAP = 16;
  let ly1 = last1 ? y(last1.v) : null;
  let ly2 = last2 ? y(last2.v) : null;
  if (ly1 !== null && ly2 !== null && Math.abs(ly1 - ly2) < MIN_GAP) {
    const mid = (ly1 + ly2) / 2;
    const up = ly1 <= ly2 ? -1 : 1;
    ly1 = mid + (up * MIN_GAP) / 2;
    ly2 = mid - (up * MIN_GAP) / 2;
  }

  const bellX = d.endTs >= x0 && d.endTs <= x1 ? x(d.endTs) : null;

  /* ── Crosshair ─────────────────────────────────────────────────────── */
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < PAD.left || px > PAD.left + plotW) return setHover(null);
    const t = x0 + ((px - PAD.left) / plotW) * (x1 - x0);
    const lastT = Math.max(last1?.t ?? x0, last2?.t ?? x0);
    setHover(Math.min(t, lastT));
  };
  const h1 = hover !== null ? valueAt(p1, hover) : null;
  const h2 = hover !== null ? valueAt(p2, hover) : null;

  /* ── Pings: once per added point, never on the first draw ──────────── */
  const counts = useRef<{ p1: number; p2: number } | null>(null);
  const [ping, setPing] = useState({ p1: 0, p2: 0 });
  useEffect(() => {
    const before = counts.current;
    // Counted on the whole series, so a window sliding past old points never rings.
    counts.current = { p1: all1.length, p2: all2.length };
    if (!before) return;
    setPing((k) => ({ p1: all1.length > before.p1 ? k.p1 + 1 : k.p1, p2: all2.length > before.p2 ? k.p2 + 1 : k.p2 }));
  }, [all1.length, all2.length]);

  const labels = useMemo(
    () => ({
      top: `+${pctAxis(half)}`,
      bottom: `-${pctAxis(half)}`,
    }),
    [half],
  );

  const described = `${t1} ${last1 ? pct(last1.v) : "no price yet"}, ${t2} ${last2 ? pct(last2.v) : "no price yet"}, from each start.`;

  return (
    <>
      {narrow && (last1 || last2) ? (
        /* The tip labels, above the chart on a phone, where the gutter was. */
        <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3 text-meta" aria-hidden="true">
          <span className="num truncate text-p1">{last1 ? `${t1} ${pct(last1.v)}` : ""}</span>
          <span className="num truncate text-p2">{last2 ? `${t2} ${pct(last2.v)}` : ""}</span>
        </div>
      ) : null}
      <div className="relative" style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Race chart. ${described}`}
          className="block touch-pan-y select-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left} y={0} width={plotW} height={height} />
            </clipPath>
          </defs>

          {/* Scale: the top and bottom of the axis, faint. */}
          <line x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top} y2={PAD.top} stroke="var(--color-line)" />
          <line x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--color-line)" />
          <text x={PAD.left + 2} y={PAD.top - 4} className="fill-dim num" fontSize={10}>
            {labels.top}
          </text>
          {/* Inside the plot's bottom edge: the clock has the strip beneath it. */}
          <text x={PAD.left + 2} y={PAD.top + plotH - 4} className="fill-dim num" fontSize={10}>
            {labels.bottom}
          </text>

          {/* The clock, in New York time, under the plot. */}
          {shownTicks.map((s) => (
            <g key={s}>
              <line x1={xRaw(s)} x2={xRaw(s)} y1={PAD.top + plotH} y2={PAD.top + plotH + 4} stroke="var(--color-faint)" />
              <text
                x={Math.min(Math.max(xRaw(s), PAD.left + 14), PAD.left + plotW - 14)}
                y={height - 8}
                textAnchor="middle"
                className="num fill-dim"
                fontSize={10}
              >
                {tickLabel(s)}
              </text>
            </g>
          ))}

          {/* Start: the dashed zero both sides race from. */}
          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--color-line-strong)"
            strokeDasharray="4 4"
          />
          <text x={PAD.left + plotW - 2} y={y(0) - 4} textAnchor="end" className="fill-dim" fontSize={10}>
            Start
          </text>

          {bellX !== null ? (
            <>
              <line x1={bellX} x2={bellX} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
              <text x={bellX - 4} y={PAD.top + 10} textAnchor="end" className="fill-dim" fontSize={10}>
                Bell
              </text>
            </>
          ) : d.endTs > x1 ? (
            /* The last 30 minutes of a long round end well before its bell.
             * Named low in the plot, since the live tips sit at its right edge. */
            <text x={PAD.left + plotW - 2} y={PAD.top + plotH - 4} textAnchor="end" className="fill-dim" fontSize={10}>
              Bell {etTime(d.endTs, false)} &rarr;
            </text>
          ) : null}

          <g clipPath={`url(#${clipId})`}>
            {area ? <path d={area} fill={`var(--color-${lead})`} fillOpacity={0.08} stroke="none" /> : null}
            <path d={path(p1)} fill="none" stroke="var(--color-p1)" strokeWidth={2} strokeDasharray={dashed ? "5 4" : undefined} strokeLinejoin="round" />
            <path d={path(p2)} fill="none" stroke="var(--color-p2)" strokeWidth={2} strokeDasharray={dashed ? "5 4" : undefined} strokeLinejoin="round" />
          </g>

          {/* Right-edge labels, in each side's colour, where there is a gutter. */}
          {!narrow && last1 && ly1 !== null ? (
            <text x={PAD.left + plotW + 10} y={ly1 + 4} className="fill-p1 num" fontSize={12}>
              {t1} {pct(last1.v)}
            </text>
          ) : null}
          {!narrow && last2 && ly2 !== null ? (
            <text x={PAD.left + plotW + 10} y={ly2 + 4} className="fill-p2 num" fontSize={12}>
              {t2} {pct(last2.v)}
            </text>
          ) : null}

          {hover !== null ? (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-ink)" strokeOpacity={0.5} />
          ) : null}
        </svg>

        {/* The tips, as HTML so the ring can draw. */}
        {last1 ? <Tip side="p1" left={x(last1.t)} top={y(last1.v)} live={live} ping={ping.p1} /> : null}
        {last2 ? <Tip side="p2" left={x(last2.t)} top={y(last2.v)} live={live} ping={ping.p2} /> : null}

        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 bg-panel-2 px-2 py-1 text-meta shadow-overlay ring-1 ring-line-strong"
            style={{ left: Math.min(Math.max(0, x(hover) - 70), width - 150), width: 150 }}
            aria-hidden="true"
          >
            <p className="text-dim">{etTime(Math.round(hover))}</p>
            <p className="num text-p1">
              {t1} {h1 !== null ? pct(h1) : "--"}
            </p>
            <p className="num text-p2">
              {t2} {h2 !== null ? pct(h2) : "--"}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Tip({ side, left, top, live, ping }: { side: "p1" | "p2"; left: number; top: number; live: boolean; ping: number }) {
  return (
    <span
      key={ping}
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
        side === "p1" ? "bg-p1 text-p1" : "bg-p2 text-p2",
        live && (side === "p1" ? "shadow-glow-p1" : "shadow-glow-p2"),
        ping > 0 && "tip-ping",
      )}
      style={{ left, top }}
    />
  );
}

/** An axis label: as few decimals as still say something. */
function pctAxis(half: number): string {
  const s = pct(half);
  return s.replace(/^\+/, "");
}
