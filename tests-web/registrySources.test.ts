/* A create is judged by the sources the chain will record.
 *
 * create_duel copies each side's source from the registry's Asset account.
 * Between a roster change and the set_asset that matches it the two disagree:
 * this release has TSLA on the oracle in roster.json while the devnet registry
 * still records Pyth. /new reads the Asset accounts (lib/hooks.ts,
 * useRegistrySources) and hands those sources to the gates, so a Saturday TSLA
 * challenge is judged as the Pyth fight it would be. */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { assetSource, coder, SOURCE_PYTH, SOURCE_SIGNED } from "../src/lib/duel";
import { nyToMs } from "../src/lib/market";
import { queueAt } from "../src/lib/stocks";

describe("the sources a fight made now would record", () => {
  const asset = (source: number) =>
    coder.accounts.encode("Asset", {
      mint: PublicKey.default,
      token_program: PublicKey.default,
      feed_id: Array(32).fill(7),
      symbol: "TSLAx",
      decimals: 8,
      enabled: true,
      bump: 255,
      source,
    });

  it("reads the source from an Asset account, and nothing from other bytes", async () => {
    expect(assetSource(await asset(SOURCE_PYTH))).to.equal(SOURCE_PYTH);
    expect(assetSource(await asset(SOURCE_SIGNED))).to.equal(SOURCE_SIGNED);
    expect(assetSource(new Uint8Array(40))).to.equal(null);
  });

  it("judges a Saturday TSLA challenge by the registry's Pyth, where the roster alone would let it run", () => {
    // Saturday 19 Sep 2026, 2 PM New York, after the cutover.
    const saturday = Math.floor(nyToMs(2026, 9, 19, 14, 0) / 1000);
    const round = { durationSecs: 43_200, endTs: 0, expiresTs: saturday + 7 * 86_400 };
    expect(queueAt("TSLA", "NVDA", saturday, round)).to.equal(null);
    const recorded = queueAt("TSLA", "NVDA", saturday, { ...round, creatorSource: SOURCE_PYTH, opponentSource: SOURCE_SIGNED });
    expect(recorded && "queued" in recorded ? recorded.why : "").to.match(/^Pyth does not publish TSLA from Friday 8:00 PM to Sunday 8:00 PM ET/);
  });
});
