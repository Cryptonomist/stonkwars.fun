/* The tab icon and the phone icon, from the same mark as everything else.
 *
 *   npx tsx scripts/make-icons.ts
 *
 * Writes src/app/icon.png (512) and src/app/apple-icon.png (180); Next serves
 * both and writes the <link> tags. Re-run after changing the mark. */

import fs from "fs";
import path from "path";
import sharp from "sharp";

import { markSvg } from "../src/lib/palette";

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const markup = Buffer.from(markSvg({ ground: "cabinet" }));
  for (const [name, size] of [
    ["icon.png", 512],
    ["apple-icon.png", 180],
  ] as const) {
    const file = path.join(ROOT, "src/app", name);
    await sharp(markup).resize(size, size).png().toFile(file);
    console.log(`${name} ${size}x${size} -> ${path.relative(ROOT, file)}`);
  }
  const ico = path.join(ROOT, "src/app/favicon.ico");
  if (fs.existsSync(ico)) {
    fs.rmSync(ico);
    console.log("removed the default favicon.ico, which would outrank icon.png");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
