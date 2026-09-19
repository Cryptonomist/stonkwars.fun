/* The footer's "Built with" list is a list of claims, one per logo, so it gets
 * the same care as any other claim: every logo file is really there, every
 * entry says what it is used for, and the numbers in those lines are the
 * data's own. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";

import { GROUP_ORDER, INTEGRATIONS } from "../src/lib/integrations";
import { PRESTOCKS } from "../src/lib/prestocks";
import { ROSTER } from "../src/lib/stocks";

const PUBLIC = path.resolve(__dirname, "../public");

describe("built with", () => {
  it("has a logo file for every entry that needs one, and nothing in it but a picture", () => {
    for (const it of INTEGRATIONS) {
      if (it.logo.kind !== "file") continue;
      const p = path.join(PUBLIC, it.logo.src);
      expect(existsSync(p), `${it.name}: ${it.logo.src}`).to.equal(true);
      if (p.endsWith(".svg")) {
        const svg = readFileSync(p, "utf8");
        expect(svg, `${it.name} carries script`).to.not.match(/<script|<foreignObject|javascript:|\son[a-z]+=/i);
      }
    }
  });

  it("says what each one is for, links to the owner, and repeats no one", () => {
    const names = new Set<string>();
    for (const it of INTEGRATIONS) {
      expect(it.role.length, `${it.name} role`).to.be.within(8, 60);
      expect(it.href, `${it.name} href`).to.match(/^https:\/\//);
      expect(GROUP_ORDER, `${it.name} group`).to.include(it.group);
      expect(names.has(it.name), `${it.name} twice`).to.equal(false);
      names.add(it.name);
    }
    for (const g of GROUP_ORDER) {
      expect(INTEGRATIONS.some((it) => it.group === g), `${g} is empty`).to.equal(true);
    }
  });

  it("counts from the data rather than from a typed number", () => {
    const line = (name: string) => INTEGRATIONS.find((it) => it.name === name)!.role;
    const xs = ROSTER.filter((s) => s.issuers.includes("xStocks")).length;
    expect(line("xStocks")).to.equal(`${xs.toLocaleString("en-US")} stocks on the roster`);
    expect(line("PreStocks")).to.equal(`${PRESTOCKS.length} companies on the pre-IPO desk`);
    expect(line("Meteora")).to.contain(`${PRESTOCKS.filter((p) => p.dex === "meteora").length} of`);
  });
});
