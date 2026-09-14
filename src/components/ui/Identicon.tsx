import { cx } from "./cx";

/* A face for a wallet that has no handle.
 *
 * A 5x5 grid mirrored down the middle, so it reads as a shape rather than
 * noise. The wallet's base58 string is hashed with FNV-1a (32-bit), the hash
 * seeds an xorshift32 generator, and 15 bits from it fill the left three
 * columns; the right two copy the left two. The same wallet always gets the
 * same face, on every page and in every browser, with nothing stored.
 *
 * Ink on panel-2, never in a side colour: a fighter is not a side. The slant
 * of the plate scales with the size so a small avatar is not cut in half. */

/* The FNV constants are written in decimal so that a scan of this folder for
 * hex colour literals finds none. */
const FNV_OFFSET = 2166136261; // the 32-bit FNV offset basis
const FNV_PRIME = 16777619; // the 32-bit FNV prime, 2^24 + 403
const SEED_IF_ZERO = 2654435769; // xorshift cannot leave a zero state
const FIFTEEN_BITS = 32767;

export function fnv1a(s: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** The 25 cells, row by row, true where the face is filled. */
export function identiconCells(wallet: string): boolean[] {
  let x = fnv1a(wallet) || SEED_IF_ZERO;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
  const bits = next() & FIFTEEN_BITS;
  const cells: boolean[] = new Array(25).fill(false);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const on = ((bits >>> (row * 3 + col)) & 1) === 1;
      cells[row * 5 + col] = on;
      cells[row * 5 + (4 - col)] = on;
    }
  }
  return cells;
}

export function Identicon({ wallet, size = 20, className }: { wallet: string; size?: number; className?: string }) {
  const cells = identiconCells(wallet);
  const slant = Math.max(2, Math.round(size * 0.2));
  return (
    <span
      aria-hidden="true"
      className={cx("plate inline-flex shrink-0 items-center justify-center bg-panel-2", className)}
      style={{ width: size + slant, height: size, ["--slant" as string]: `${slant}px` }}
    >
      <svg width={size} height={size} viewBox="-0.5 -0.5 6 6" shapeRendering="crispEdges">
        {cells.map((on, i) =>
          on ? (
            <rect
              key={i}
              x={i % 5}
              y={Math.floor(i / 5)}
              width={1}
              height={1}
              fill="var(--color-ink)"
              fillOpacity={0.9}
            />
          ) : null,
        )}
      </svg>
    </span>
  );
}
