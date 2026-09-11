"use client";

/* The pre-fight screen: the two picks side by side, with the stats that decide
 * a short fight. Bars run out from the middle, so the longer one is the one
 * ahead on that row.
 *
 * Every number is the stock's own recent past and nothing more. It is not a
 * forecast, it decides nothing, and the program never sees it — see
 * lib/fighterStats.ts. */

import { byTicker } from "@/lib/stocks";
import { formBar, powerBar, tale, type Fighter } from "@/lib/fighterStats";
import { useFighters } from "@/lib/useFighters";

const ROWS = [
  { key: "power" as const, label: "Power", hint: "Average daily move, either way. The bigger swinger has more room to win, and to lose." },
  { key: "form" as const, label: "Form", hint: "Where it has gone over the last five sessions." },
  { key: "room" as const, label: "Room", hint: "Where it sits in its own month: at the top of the range, or near the bottom." },
];

export function TaleOfTheTape({ p1, p2 }: { p1: string | null; p2: string | null }) {
  const { data } = useFighters([p1, p2]);
  const f1 = p1 ? data?.[p1] : null;
  const f2 = p2 ? data?.[p2] : null;
  if (!p1 || !p2) return null;

  return (
    <section className="card mt-8 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="display text-3xl">Tale of the tape</h2>
        <p className="text-xs text-dim">Last month of closes · decides nothing</p>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1 sm:gap-x-5">
        <span className="display truncate text-4xl text-p1 sm:text-5xl">{p1}</span>
        <span className="label text-center">vs</span>
        <span className="display truncate text-right text-4xl text-p2 sm:text-5xl">{p2}</span>

        <span className="truncate text-xs text-dim">{byTicker(p1)?.name}</span>
        <span />
        <span className="truncate text-right text-xs text-dim">{byTicker(p2)?.name}</span>

        <Spark f={f1} side="p1" />
        <span />
        <Spark f={f2} side="p2" />

        {ROWS.map((row) => (
          <Row key={row.key} row={row} f1={f1} f2={f2} />
        ))}
      </div>

      <p className="mt-4 text-sm text-dim">
        {f1 && f2 ? tale(f1, f2) : "Reading the last month of closes..."}
      </p>
    </section>
  );
}

function Row({
  row,
  f1,
  f2,
}: {
  row: (typeof ROWS)[number];
  f1: Fighter | null | undefined;
  f2: Fighter | null | undefined;
}) {
  return (
    <>
      <div className="col-span-3 mt-3 border-t border-line pt-3" />
      <Bar f={f1} stat={row.key} side="p1" />
      <span className="label whitespace-nowrap text-center" title={row.hint}>
        {row.label}
      </span>
      <Bar f={f2} stat={row.key} side="p2" />
    </>
  );
}

/** One side of one row: the number, and a bar growing towards the middle. */
function Bar({ f, stat, side }: { f: Fighter | null | undefined; stat: "power" | "form" | "room"; side: "p1" | "p2" }) {
  const right = side === "p2";
  if (!f) {
    return <span className={`font-mono text-sm text-dim ${right ? "text-right" : ""}`}>--</span>;
  }

  const value = stat === "power" ? f.power : stat === "form" ? f.form : f.room;
  const share = stat === "power" ? powerBar(f.power) : stat === "form" ? formBar(f.form) : f.room / 100;
  const text =
    stat === "power"
      ? `${value.toFixed(2)}%/day`
      : stat === "form"
        ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
        : `${Math.round(value)} of 100`;
  const tone =
    stat === "form" ? (value >= 0 ? "text-up" : "text-down") : side === "p1" ? "text-p1" : "text-p2";
  const fill = stat === "form" ? (value >= 0 ? "var(--color-up)" : "var(--color-down)") : `var(--color-${side})`;

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${right ? "items-start" : "items-end"}`}>
      <span className={`font-mono text-sm tabular-nums ${tone}`}>{text}</span>
      <span className={`flex h-1.5 w-full ${right ? "justify-start" : "justify-end"}`} aria-hidden="true">
        <span className="bar-fill" style={{ width: `${Math.max(2, share * 100)}%`, background: fill }} />
      </span>
      {stat === "form" && Math.abs(f.streak) >= 2 ? (
        <span className="text-[10px] uppercase tracking-wider text-dim">
          {Math.abs(f.streak)} {f.streak > 0 ? "up" : "down"} in a row
        </span>
      ) : null}
    </div>
  );
}

/** The month, drawn small. */
function Spark({ f, side }: { f: Fighter | null | undefined; side: "p1" | "p2" }) {
  if (!f || f.closes.length < 2) return <span className="h-10" />;
  const w = 200;
  const h = 40;
  const high = Math.max(...f.closes);
  const low = Math.min(...f.closes);
  const span = high - low || 1;
  const points = f.closes
    .map((c, i) => `${(i / (f.closes.length - 1)) * w},${h - ((c - low) / span) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={`var(--color-${side})`} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
