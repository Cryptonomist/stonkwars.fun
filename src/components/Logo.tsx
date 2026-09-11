/* The mark: two stock charts crossed like swords. Both climb, because both
 * fighters are long their own stock; the fight is over which climbs further. */

export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="none"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <polyline points="4,27 10,19 14,22 25,7" stroke="var(--color-p1)" strokeWidth="3.2" />
      <polyline points="21,6 26,6 26,11" stroke="var(--color-p1)" strokeWidth="3.2" />
      <polyline points="28,27 22,19 18,22 7,7" stroke="var(--color-p2)" strokeWidth="3.2" />
      <polyline points="11,6 6,6 6,11" stroke="var(--color-p2)" strokeWidth="3.2" />
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
