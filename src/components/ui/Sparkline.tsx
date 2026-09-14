import { cx } from "./cx";

/* A line and nothing else: no axes, no grid, a dot on the latest point.
 *
 * The data picks the colour, never the page. "move" is green when the last
 * value is at or above the first and red when below, because that is what the
 * line says happened; "p1" and "p2" are for a line that stands for a side;
 * "ink" for anything else. Missing values are skipped and the line joins
 * across them. With fewer than two real points there is no line to draw, and
 * a faint dash says so rather than a flat line that implies a price held. */

export type SparkTone = "move" | "p1" | "p2" | "ink";

const TONE_CLASS = { p1: "text-p1", p2: "text-p2", ink: "text-ink" } as const;

export function Sparkline({
  values,
  width = 64,
  height = 20,
  tone = "move",
  label,
  className,
}: {
  values: readonly (number | null | undefined)[];
  width?: number;
  height?: number;
  tone?: SparkTone;
  label: string;
  className?: string;
}) {
  const pts: [number, number][] = [];
  values.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) pts.push([i, v]);
  });

  if (pts.length < 2) {
    return (
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cx("shrink-0", className)}
      >
        <line
          x1={width * 0.3}
          x2={width * 0.7}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--color-faint)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const first = pts[0][1];
  const last = pts[pts.length - 1][1];
  const colour = tone === "move" ? (last >= first ? "text-up" : "text-down") : TONE_CLASS[tone];

  /* Inset by the dot's radius so neither the dot nor the stroke is clipped at
   * the edges of the box. */
  const r = 2;
  const pad = r + 0.5;
  const span = Math.max(1, values.length - 1);
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of pts) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const x = (i: number) => pad + (i / span) * (width - pad * 2);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));

  const points = pts.map(([i, v]) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const [li, lv] = pts[pts.length - 1];

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx("shrink-0", colour, className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(li)} cy={y(lv)} r={r} fill="currentColor" />
    </svg>
  );
}
