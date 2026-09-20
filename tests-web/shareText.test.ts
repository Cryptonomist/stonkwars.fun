/* The post is the product's only way out of the tab, so what it says is pinned:
 * who is named, that the dollars are there, and that nobody is tagged unless
 * their wallet linked that handle on chain. */

import { expect } from "chai";

import { calloutPrefix, koPostText, type KoPost } from "../src/lib/shareText";

const base: KoPost = { win: "INTC", lose: "MU", mw: 0.39, ml: -0.24, byPyth: false, viewer: "other" };

describe("what a result says when posted", () => {
  it("the winner's post tags the loser, gives the dollars and asks for the rematch", () => {
    const t = koPostText({ ...base, viewer: "winner", loserHandle: "rival", tookUsd: "$24.93" });
    expect(t).to.equal("Cooked @rival. INTC +0.39% vs MU -0.24%, settled on Solana. Took $24.93 of MU. Run it back?");
  });

  it("the loser's post tags the winner and points at the rematch", () => {
    const t = koPostText({ ...base, viewer: "loser", winnerHandle: "@champ" });
    expect(t).to.match(/^@champ cooked me by 0\.63 points\./);
    expect(t).to.match(/Rematch is open:$/);
  });

  it("a spectator's post names the winner with the dollars, and calls the loser out", () => {
    const t = koPostText({ ...base, winnerHandle: "champ", loserHandle: "rival", tookUsd: "$24.93" });
    expect(t).to.contain("@champ took both stakes, $24.93.");
    expect(t).to.match(/@rival, your move\.$/);
  });

  it("tags nobody who has not linked a handle", () => {
    const t = koPostText({ ...base, viewer: "winner", tookUsd: "$24.93" });
    expect(t).to.not.contain("@");
    expect(t).to.match(/^Cooked MU\./);
    expect(koPostText(base)).to.not.contain("@");
  });

  it("says Pyth only when both sides were Pyth's", () => {
    expect(koPostText({ ...base, byPyth: true })).to.contain("settled by Pyth on Solana");
    expect(koPostText(base)).to.contain("settled on Solana");
  });

  it("a called-out challenge tags its invitee, and only with a linked handle", () => {
    expect(calloutPrefix("rival")).to.equal("@rival you are called out. ");
    expect(calloutPrefix(null)).to.equal("");
  });
});
