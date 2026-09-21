/* Calling somebody out by their X handle. What is pinned: a pasted wallet is
 * never reread as a name, a handle only resolves to the wallet that linked it
 * on chain, and an unknown handle says what to do next. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { calloutError, resolveCallout } from "../src/lib/callout";

const A = PublicKey.unique().toBase58();
const B = PublicKey.unique().toBase58();
const handles = { [A]: "Crypt0nomist", [B]: "rival_99" };

describe("calling somebody out by name", () => {
  it("resolves a handle to the wallet that linked it, whatever the case, with or without the @", () => {
    expect(resolveCallout("@crypt0nomist", handles)).to.deep.equal({ kind: "wallet", wallet: A, handle: "Crypt0nomist" });
    expect(resolveCallout("  RIVAL_99 ", handles)).to.deep.equal({ kind: "wallet", wallet: B, handle: "rival_99" });
  });

  it("takes a pasted wallet as a wallet, and says whose it is when the chain knows", () => {
    expect(resolveCallout(A, handles)).to.deep.equal({ kind: "wallet", wallet: A, handle: "Crypt0nomist" });
    const stranger = PublicKey.unique().toBase58();
    expect(resolveCallout(stranger, handles)).to.deep.equal({ kind: "wallet", wallet: stranger, handle: null });
  });

  it("names nobody who has not linked that handle", () => {
    const c = resolveCallout("@elonmusk", handles);
    expect(c).to.deep.equal({ kind: "unknown-handle", handle: "elonmusk" });
    expect(calloutError(c, true)).to.match(/^No wallet has linked @elonmusk yet\./);
    expect(calloutError(c, false)).to.equal("Looking that handle up...");
  });

  it("refuses what is neither, and says nothing about an empty box or a good answer", () => {
    expect(resolveCallout("not a handle!", handles).kind).to.equal("invalid");
    expect(resolveCallout("@way_too_long_for_a_handle", handles).kind).to.equal("invalid");
    expect(calloutError(resolveCallout("", handles), true)).to.equal(null);
    expect(calloutError(resolveCallout("@rival_99", handles), true)).to.equal(null);
  });
});
