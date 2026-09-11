// Contact sheet of profile pictures, circle-cropped as X shows them, at 200px
// and at feed size (48px), on X's dark and light grounds.
//   node scripts/pfp-sheet.mjs <dir> <name,name,...> <out.png>
import sharp from "sharp";
import path from "path";

const [dir, names, out] = process.argv.slice(2);
const list = names.split(",");
const big = 200;
const small = 48;
const cell = 250;
const rows = [
  { ground: "#000000", label: "#8b98a5" },
  { ground: "#ffffff", label: "#536471" },
];

const circle = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

async function round(file, size) {
  return sharp(file)
    .resize(size, size)
    .composite([{ input: circle(size), blend: "dest-in" }])
    .png()
    .toBuffer();
}

const width = cell * list.length;
const height = rows.length * (big + small + 90);
const layers = [];
for (const [r, row] of rows.entries()) {
  const top = r * (big + small + 90);
  layers.push({ input: { create: { width, height: big + small + 90, channels: 4, background: row.ground } }, left: 0, top });
  for (const [i, name] of list.entries()) {
    const file = path.join(dir, `${name}-pfp.png`);
    const left = i * cell + (cell - big) / 2;
    layers.push({ input: await round(file, big), left, top: top + 16 });
    layers.push({ input: await round(file, small), left: i * cell + (cell - small) / 2, top: top + big + 28 });
    const label = Buffer.from(
      `<svg width="${cell}" height="24"><text x="${cell / 2}" y="17" font-family="sans-serif" font-size="15" fill="${row.label}" text-anchor="middle">${name}</text></svg>`,
    );
    layers.push({ input: label, left: i * cell, top: top + big + small + 44 });
  }
}
await sharp({ create: { width, height, channels: 4, background: "#000" } })
  .composite(layers)
  .png()
  .toFile(out);
console.log(`wrote ${out}`);
