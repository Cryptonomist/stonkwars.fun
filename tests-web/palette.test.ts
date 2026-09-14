/* The hex palette against the stylesheet it copies.
 *
 * Share cards and brand images are drawn where CSS variables cannot reach, so
 * lib/palette.ts spells the arena's colours out as hex. A copy drifts: a token
 * gets retuned in globals.css, the share card keeps the old value, and the
 * picture people post stops looking like the site. So this reads the real
 * @theme block from disk and holds every palette entry to its token, both
 * ways, and checks that the comparison itself notices a changed hex. */

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PALETTE } from "../src/lib/palette";

/** Palette colours with no token, on purpose: the mark's violet ground. */
const NOT_TOKENS = new Set(["cabinet"]);

/** "panel2" -> "panel-2", "p1Deep" -> "p1-deep", "lineStrong" -> "line-strong".
 *  A digit after a one-letter side name stays attached (p1, p2). */
const kebab = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-z]{2,})(\d+)/g, "$1-$2")
    .toLowerCase();

/** Every --color-NAME: #hex inside the @theme block, names without the prefix. */
function themeColors(css: string): Map<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error("No @theme block in globals.css");
  const out = new Map<string, string>();
  for (const m of block[1].matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

/** What disagrees: palette keys whose hex differs from, or has no, token. */
function mismatches(palette: Record<string, string>, tokens: Map<string, string>): string[] {
  const bad: string[] = [];
  for (const [key, hex] of Object.entries(palette)) {
    if (NOT_TOKENS.has(key)) continue;
    const token = tokens.get(kebab(key));
    if (token !== hex.toLowerCase()) bad.push(`${key} ${hex} vs --color-${kebab(key)} ${token ?? "(missing)"}`);
  }
  return bad;
}

describe("palette", () => {
  const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
  const tokens = themeColors(css);

  it("reads the colour tokens out of @theme", () => {
    expect(tokens.size).to.be.greaterThan(10);
    expect(tokens.get("void")).to.equal("#07070b");
    expect(tokens.get("panel-2")).to.match(/^#[0-9a-f]{6}$/);
  });

  it("turns palette keys into token names", () => {
    expect(kebab("void")).to.equal("void");
    expect(kebab("p1")).to.equal("p1");
    expect(kebab("panel2")).to.equal("panel-2");
    expect(kebab("panel3")).to.equal("panel-3");
    expect(kebab("lineStrong")).to.equal("line-strong");
    expect(kebab("p1Deep")).to.equal("p1-deep");
    expect(kebab("p2Tint")).to.equal("p2-tint");
    expect(kebab("downTint")).to.equal("down-tint");
  });

  it("matches every token it copies, case-insensitively", () => {
    expect(mismatches(PALETTE, tokens)).to.deep.equal([]);
  });

  it("copies every colour token, so a new one cannot be missed", () => {
    const copied = new Set(Object.keys(PALETTE).filter((k) => !NOT_TOKENS.has(k)).map(kebab));
    expect([...tokens.keys()].filter((name) => !copied.has(name))).to.deep.equal([]);
  });

  it("keeps the colours with no token off the stylesheet's names", () => {
    for (const key of NOT_TOKENS) {
      expect(PALETTE).to.have.property(key);
      expect(tokens.has(kebab(key)), key).to.equal(false);
    }
  });

  it("notices a changed hex", () => {
    const upper = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, v.toUpperCase()]));
    expect(mismatches(upper, tokens)).to.deep.equal([]);
    expect(mismatches({ ...PALETTE, p1: "#2fe0fe" }, tokens)).to.have.length(1);
    expect(mismatches({ ...PALETTE, panel2: "#15151e" }, tokens)).to.have.length(1);
  });
});
