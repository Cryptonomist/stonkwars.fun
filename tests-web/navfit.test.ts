/* The header's one row, and the rule that decides what is on it.
 *
 * The widths in here are the real ones, read off the rendered header in a
 * browser at 1366px with a connected wallet on devnet, which is the state that
 * broke: the row needed 1337px and the column gives 1248px at every desktop
 * size. The point of these is that the rule never lets that become an overlap
 * again, whatever somebody adds to the nav next.
 */

import { expect } from "chai";

import { fitRow, type Slot } from "../src/lib/navfit";

/** Measured in the browser, in px. */
const W = {
  wordmark: 151,
  fights: 64,
  trade: 59,
  preIpo: 72,
  leaderboard: 108,
  how: 117,
  searchIcon: 40,
  searchWord: 67,
  status: 212,
  faucet: 126,
  cta: 101,
  wallet: 126,
  more: 75,
};

const GAP = 8;
/** The column is max-w-7xl with px-4 either side, at any desktop width. */
const ROW = 1248;

/** What is left once the pieces that never move have taken theirs. */
function roomForSlots(anchors: number[]): number {
  const taken = anchors.reduce((t, w) => t + w, 0) + GAP * (anchors.length - 1);
  return ROW - taken;
}

const DESKTOP_ANCHORS = [W.wordmark, W.searchIcon, W.cta, W.wallet];

function header(): Slot[] {
  return [
    { key: "/fights", width: W.fights, rank: 90, fold: "menu" },
    { key: "/trade", width: W.trade, rank: 80, fold: "menu" },
    { key: "/leaderboard", width: W.leaderboard, rank: 70, fold: "menu" },
    { key: "status", width: W.status, rank: 65, fold: "hide" },
    { key: "/pre-ipo", width: W.preIpo, rank: 55, fold: "menu" },
    { key: "/how", width: W.how, rank: 50, fold: "menu" },
    { key: "faucet", width: W.faucet, rank: 45, fold: "menu" },
    { key: "search-word", width: W.searchWord, rank: 20, fold: "hide" },
  ];
}

const fit = (slots: Slot[], available: number) => fitRow(slots, { available, gap: GAP, moreWidth: W.more });

describe("what fits in the header", () => {
  it("keeps the lot when the row is wide enough", () => {
    const r = fit(header(), 4000);
    expect(r.menu).to.deep.equal([]);
    expect(r.hidden).to.deep.equal([]);
    expect(r.inline).to.have.length(8);
    expect(r.spare).to.be.above(0);
  });

  it("never asks for more room than there is", () => {
    /* Every width from a small phone to a wide monitor, with and without the
     * pieces that come and go. The rule may run out of things to give, but it
     * may never claim a row fits when it does not. */
    for (const anchors of [DESKTOP_ANCHORS, [W.wordmark, W.searchIcon, W.wallet]]) {
      const room = roomForSlots(anchors);
      for (let width = 320; width <= 1400; width += 4) {
        const available = room - (ROW - width);
        const r = fit(header(), available);
        const shown = header().filter((s) => r.inline.includes(s.key));
        const used =
          shown.reduce((t, s) => t + s.width + GAP, 0) + (r.menu.length > 0 ? W.more + GAP : 0);
        if (r.inline.length > 0) {
          expect(used, `${width}px with ${anchors.length} fixed pieces`).to.be.at.most(
            Math.max(available, 0) + GAP,
          );
        }
      }
    }
  });

  it("gives up the market's session and the search word before a place to go", () => {
    /* The row at its real desktop width, everything showing, over by 83px. */
    const r = fit(header(), roomForSlots(DESKTOP_ANCHORS));
    expect(r.hidden).to.include("search-word");
    expect(r.inline).to.include.members(["/fights", "/trade", "/leaderboard"]);
    expect(r.spare).to.be.at.least(0);
  });

  it("folds places to go into the menu and never off the row", () => {
    const r = fit(header(), 300);
    for (const key of ["/fights", "/trade", "/leaderboard", "/pre-ipo", "/how"]) {
      expect(r.hidden, `${key} is reachable`).to.not.include(key);
      expect(r.inline.includes(key) || r.menu.includes(key), `${key} is somewhere`).to.equal(true);
    }
    expect(r.hidden).to.include.members(["status", "search-word"]);
  });

  it("pays for the MORE button once, however much folds into it", () => {
    const three: Slot[] = [
      { key: "a", width: 100, rank: 30, fold: "menu" },
      { key: "b", width: 100, rank: 20, fold: "menu" },
      { key: "c", width: 100, rank: 10, fold: "menu" },
    ];
    /* Room for one 100px piece and the 75px button: both of the others fold,
     * and the second one to fold costs nothing more than its own place. */
    const r = fitRow(three, { available: 100 + GAP + W.more + GAP, gap: GAP, moreWidth: W.more });
    expect(r.inline).to.deep.equal(["a"]);
    expect(r.menu).to.deep.equal(["b", "c"]);
  });

  it("keeps the page you are on, even when there is no room for it", () => {
    const slots = header().map((s) => (s.key === "/how" ? { ...s, pinned: true } : s));
    const r = fit(slots, 60);
    expect(r.inline).to.deep.equal(["/how"]);
    expect(r.spare).to.be.below(0);
  });

  it("gives up the same things in the same order as the row narrows", () => {
    /* Nothing comes back as the window shrinks: a piece that has folded stays
     * folded, so the header never flickers items in and out mid-drag. */
    const room = roomForSlots(DESKTOP_ANCHORS);
    let last: string[] | null = null;
    for (let available = room; available >= 0; available -= 2) {
      const inline = fit(header(), available).inline;
      if (last) expect(inline, `${available}px`).to.satisfy((now: string[]) => now.every((k) => last!.includes(k)));
      last = inline;
    }
  });

  it("makes room for a sixth link by folding the least important piece, not by breaking the row", () => {
    /* The regression this rule exists for: two links were added to a header
     * measured for three, and the row went 89px over. */
    const grown = [...header(), { key: "/vault", width: 90, rank: 35, fold: "menu" as const }];
    const r = fit(grown, roomForSlots(DESKTOP_ANCHORS));
    const used =
      grown.filter((s) => r.inline.includes(s.key)).reduce((t, s) => t + s.width + GAP, 0) +
      (r.menu.length > 0 ? W.more + GAP : 0);
    expect(used).to.be.at.most(roomForSlots(DESKTOP_ANCHORS));
    expect(r.inline).to.include.members(["/fights", "/trade"]);
  });
});
