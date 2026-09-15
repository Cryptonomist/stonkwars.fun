/* The oracle key's diagnosis is handed to any caller of /api/quote, so it must
 * name the mistake without repeating any of the key. The values here are made
 * up for the test: a string of base58 letters shaped like an exported secret,
 * never a real key. */

import { expect } from "chai";

import { keyShape, oracleKeyProblem } from "../src/lib/oracleKey.server";

describe("the oracle key's diagnosis", () => {
  const saved = { key: process.env.ORACLE_SECRET_KEY, cluster: process.env.NEXT_PUBLIC_CLUSTER };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ORACLE_SECRET_KEY;
    else process.env.ORACLE_SECRET_KEY = saved.key;
    if (saved.cluster === undefined) delete process.env.NEXT_PUBLIC_CLUSTER;
    else process.env.NEXT_PUBLIC_CLUSTER = saved.cluster;
  });

  it("says a key pasted as text is not JSON without repeating any of it", () => {
    const pasted = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T3m8ErXyTdpsmBn3kW9cPxS5qRzt2ZF7yL";
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    process.env.ORACLE_SECRET_KEY = pasted;
    const why = oracleKeyProblem()!;
    expect(why.problem).to.equal("ORACLE_SECRET_KEY is set but is not JSON");
    expect(why.detail.startsWith(`It is ${pasted.length} characters, all base58 letters and digits`)).to.equal(true);
    for (let i = 0; i + 4 <= pasted.length; i++) expect(why.detail, `characters ${i} to ${i + 4}`).to.not.include(pasted.slice(i, i + 4));
  });

  it("describes the other shapes a wrong value takes", () => {
    expect(keyShape('"[1,2,3]"')).to.equal(", wrapped in quotes");
    expect(keyShape("[1,2,3")).to.equal(", starting with a square bracket but not a complete list");
    expect(keyShape("not a key at all")).to.equal("");
  });
});
