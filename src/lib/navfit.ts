/* WHAT FITS IN THE HEADER'S ONE ROW.
 *
 * The header carries the wordmark, the places to go, search, the market's
 * session, the faucet on test clusters, Pick a fight and the wallet, inside a
 * column that stops growing at 1280px. Take the padding off and that is 1248px
 * of room on a 1366px laptop and on a 4K monitor alike: the header's budget is
 * the same number at every desktop size, so no breakpoint above 1312px can buy
 * it another pixel.
 *
 * It did not all fit. The budget was measured by hand once ("1280 adds the
 * worded search box and the market's session, with about 20px to spare"), two
 * more links were added later, nobody re-measured, and the row went 89px over
 * with a connected wallet: the right-hand group, which was allowed to shrink
 * under its own contents, printed the search box on top of How it works and
 * pushed the wallet under the edge of the window.
 *
 * So the row is measured while it runs instead of guessed in advance. Every
 * piece that can give reports what it actually occupies, this decides what
 * stays, and the sixth link somebody adds next costs the least important piece
 * its place rather than breaking the row.
 *
 * No DOM in here: widths in, keys out. components/SiteNav.tsx does the
 * measuring and the drawing.
 */

/** Where a piece goes when the row runs short. */
export type Fold =
  /** Into the MORE menu: somewhere to go, or something to do. */
  | "menu"
  /** Off the row: ambient readouts nobody navigates by. */
  | "hide";

export type Slot = {
  key: string;
  /** What it occupies right now, measured, in px. */
  width: number;
  /** What it costs to give up: the lowest goes first. */
  rank: number;
  fold: Fold;
  /** The page somebody is on. It never folds: a nav that hides where you are
   *  is worse than a nav that is one item shorter. */
  pinned?: boolean;
};

export type Fit = {
  /** Keys still on the row, in the order they were given. */
  inline: string[];
  /** Keys inside the MORE menu, in the order they were given. */
  menu: string[];
  /** Keys taken off the row altogether. */
  hidden: string[];
  /** Room left over, in px. Negative when even the pinned pieces do not fit. */
  spare: number;
};

/** Everything on a row costs its own width plus the gap in front of it. */
const costOf = (width: number, gap: number) => width + gap;

/**
 * Decide what a row of `available` px can hold.
 *
 * `available` is what is left after the pieces that never move (the wordmark,
 * search, Pick a fight, the wallet) have taken their widths and their gaps.
 * `moreWidth` is the MORE button, which is paid for once, the first time
 * anything folds into it.
 */
export function fitRow(
  slots: Slot[],
  { available, gap, moreWidth }: { available: number; gap: number; moreWidth: number },
): Fit {
  let total = slots.reduce((t, s) => t + costOf(s.width, gap), 0);

  const folded = new Set<string>();
  const inMenu = new Set<string>();
  let payingForMore = false;

  /* Give up the cheapest piece, then the next, until the row fits. Ties go to
   * the piece further along the row, so a fold never reorders what is left. */
  const givingOrder = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.pinned)
    .sort((a, b) => a.s.rank - b.s.rank || b.i - a.i);

  for (const { s } of givingOrder) {
    if (total <= available) break;
    total -= costOf(s.width, gap);
    folded.add(s.key);
    if (s.fold === "menu") {
      inMenu.add(s.key);
      if (!payingForMore) {
        payingForMore = true;
        total += costOf(moreWidth, gap);
      }
    }
  }

  return {
    inline: slots.filter((s) => !folded.has(s.key)).map((s) => s.key),
    menu: slots.filter((s) => inMenu.has(s.key)).map((s) => s.key),
    hidden: slots.filter((s) => folded.has(s.key) && !inMenu.has(s.key)).map((s) => s.key),
    spare: Math.round(available - total),
  };
}
