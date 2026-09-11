/* The mark: two candlesticks crossed like swords, and the spark where they
 * hit. Cyan and pink rather than the market's green and red, because those two
 * already mean up and down on every other surface in the app.
 *
 * The geometry matches lib/palette.ts, which draws the same mark for images;
 * this one is inline so it takes the page's colours. */

const CANDLES: { rotate: number; color: string }[] = [
  { rotate: 34, color: "var(--color-p2)" },
  { rotate: -34, color: "var(--color-p1)" },
];

/** A star's points, for the spark. Mirrors sparkPoints in lib/palette.ts. */
function spark(outer: number, inner: number, spikes = 8): string {
  return Array.from({ length: spikes * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    const r = i % 2 ? inner : outer;
    return `${(200 + Math.cos(a) * r).toFixed(1)},${(200 + Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");
}

export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const edge = "var(--color-void)";
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" aria-hidden="true" className={className}>
      {CANDLES.map((c) => (
        <g key={c.rotate} transform={`rotate(${c.rotate} 200 200)`}>
          <rect x="189" y="39" width="22" height="322" rx="3" fill={edge} />
          <rect x="192" y="42" width="16" height="316" rx="2" fill={c.color} />
          <rect x="140" y="86" width="120" height="228" rx="6" fill={edge} />
          <rect x="147" y="93" width="106" height="214" rx="3" fill={c.color} />
        </g>
      ))}
      <polygon points={spark(54, 16)} fill={edge} />
      <polygon points={spark(46, 14)} fill="#ffffff" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`display inline-flex items-center gap-2 ${className}`}>
      <Mark size={26} />
      <span className="-skew-x-6 text-[1.55rem] leading-none tracking-tight">
        STONK<span className="text-p2">WARS</span>
      </span>
    </span>
  );
}
