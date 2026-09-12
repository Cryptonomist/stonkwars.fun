import { expect } from "chai";

import { authorise } from "../src/lib/crankAuth.server";

/* The settler is configured by typing into a web form on another site, and for
 * a long time the only thing that form got back was the number 401. Every case
 * below is a way that typing goes wrong. Each one has to be told apart from the
 * others, because the reply is the only diagnosis anybody ever sees. */

const SECRET = "s3cr3t-value-nobody-should-see";
/* Two arguments, never defaulted: passing `undefined` for the secret is the
 * case where the deployment has none, and a default parameter would quietly
 * turn that test into a copy of the one above it. */
const why = (header: string | null, secret: string | undefined) => {
  const r = authorise(header, secret);
  return r.ok ? null : r.why;
};
const whyFor = (header: string | null) => why(header, SECRET);

describe("who may spend the crank wallet's SOL", () => {
  it("lets the correct header through", () => {
    expect(authorise(`Bearer ${SECRET}`, SECRET).ok).to.equal(true);
  });

  it("refuses everyone else", () => {
    expect(authorise(`Bearer ${SECRET}x`, SECRET).ok).to.equal(false);
    expect(authorise("Bearer ", SECRET).ok).to.equal(false);
    expect(authorise("", SECRET).ok).to.equal(false);
  });
});

describe("forgiving about the shape", () => {
  it("accepts a scheme in any case, because a form is not an intruder", () => {
    expect(authorise(`bearer ${SECRET}`, SECRET).ok).to.equal(true);
    expect(authorise(`BEARER ${SECRET}`, SECRET).ok).to.equal(true);
  });

  it("accepts the whitespace a paste leaves behind", () => {
    expect(authorise(`Bearer ${SECRET} `, SECRET).ok).to.equal(true);
    expect(authorise(`  Bearer ${SECRET}\n`, SECRET).ok).to.equal(true);
    expect(authorise(`Bearer  ${SECRET}`, SECRET).ok).to.equal(true);
    expect(authorise(`Bearer\t${SECRET}`, SECRET).ok).to.equal(true);
  });
});

describe("strict about the secret", () => {
  it("does not accept a prefix of it", () => {
    expect(authorise(`Bearer ${SECRET.slice(0, -1)}`, SECRET).ok).to.equal(false);
  });

  it("does not accept a different case of it", () => {
    expect(authorise(`Bearer ${SECRET.toUpperCase()}`, SECRET).ok).to.equal(false);
  });
});

describe("saying which mistake it was", () => {
  it("separates a missing server secret from a wrong sent one", () => {
    expect(why(`Bearer ${SECRET}`, undefined)).to.match(/CRON_SECRET is not set/);
  });

  it("names a redirect when no header arrives, since that is what eats them", () => {
    expect(whyFor(null)).to.match(/No Authorization header/).and.to.match(/redirect/);
  });

  it("catches the missing space, which is the mistake people actually make", () => {
    expect(whyFor(SECRET)).to.match(/no scheme/);
    expect(whyFor(SECRET)).to.match(/single space after Bearer/);
  });

  it("distinguishes a wrong scheme from a wrong token", () => {
    expect(whyFor(`Token ${SECRET}`)).to.match(/scheme is not Bearer/);
    expect(whyFor(`Bearer wrong`)).to.match(/does not match CRON_SECRET/);
  });

  it("gives both lengths, so a truncated paste is obvious", () => {
    const m = whyFor(`Bearer ${SECRET.slice(0, 10)}`);
    expect(m).to.contain("10 characters");
    expect(m).to.contain(`${SECRET.length} were expected`);
  });
});

describe("never handing back what it was sent", () => {
  /* The commonest misconfiguration is the secret pasted with no scheme, so the
   * refusal for that case is reading the secret itself. It must not repeat any
   * of it, or the diagnosis becomes the leak. */
  const leaky = [null, "", SECRET, `${SECRET} `, `Token ${SECRET}`, `Bearer ${SECRET.slice(0, 10)}`, `bear ${SECRET}`];

  for (const header of leaky) {
    it(`says nothing of the secret when sent ${header === null ? "no header" : `a ${header.length}-character header`}`, () => {
      const m = whyFor(header) ?? "";
      expect(m).to.not.contain(SECRET);
      // Nor any run of it long enough to be worth having.
      for (let i = 0; i + 6 <= SECRET.length; i++) {
        expect(m).to.not.contain(SECRET.slice(i, i + 6));
      }
    });
  }
});
