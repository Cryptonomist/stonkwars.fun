"use client";

/* THE SWITCH THAT FOLLOWS YOU AROUND THE SITE.
 *
 * The question it answers is whether cyan and pink are doing too much work, and
 * no mock-up can answer that, because what is being judged is the weight of a
 * colour across a whole site: the nav, a board of fights, a live round, the
 * trade desk. So the switch rides along on the real pages.
 *
 * It appears once /palette has been visited, or any URL carrying ?palette, and
 * then only in that browser tab. A visitor who never asks sees nothing.
 *
 * What it swaps is in globals.css under [data-palette="calm"], and it is not a
 * new set of hues. Cyan and pink keep every side of every fight; they lose the
 * two other jobs they had picked up. Delete this file, its line in layout.tsx,
 * lib/paletteLab.ts, app/palette and the calm block in globals.css once the
 * choice is made, whichever way it goes. */

import Link from "next/link";
import { useEffect, useState } from "react";

import { applyPalette, PALETTES, paletteOf, readPalette, writePalette, type Palette } from "@/lib/paletteLab";
import { cx } from "./ui/cx";

export function PaletteLab() {
  const [shown, setShown] = useState(false);
  const [palette, setPalette] = useState<Palette>("current");

  /* Read once on mount rather than through useSearchParams, which would put
   * every page in the app behind a Suspense boundary for a preview tool. */
  useEffect(() => {
    const stored = readPalette();
    const asked = new URLSearchParams(window.location.search).has("palette");
    if (!asked && (stored === null || stored === "off")) return;
    const next = paletteOf(stored);
    setShown(true);
    setPalette(next);
    writePalette(next);
  }, []);

  useEffect(() => {
    if (!shown) return;
    applyPalette(palette);
    writePalette(palette);
  }, [shown, palette]);

  /* The switch is for one person deciding one thing, so it stays out of the way
   * on a phone, where it would sit on top of the page it is meant to show. */
  if (!shown) return null;

  return (
    <div className="fixed bottom-4 left-3 z-50 hidden max-w-56 flex-col gap-2 bg-panel-3 p-3 shadow-overlay ring-2 ring-ink sm:flex">
      <p className="label text-ink">Palette preview</p>
      {/* Stacked, because four of these side by side would each be too narrow
        * to read at the button's own type size. */}
      <div className="flex flex-col gap-1">
        {PALETTES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={palette === value}
            onClick={() => setPalette(value)}
            className={cx("btn btn-sm w-full px-3", palette === value ? "btn-light" : "btn-ghost")}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="text-micro text-dim">
        Each one is the one above it plus a little more. Browse the site with it on.{" "}
        <Link href="/palette" className="link">
          What changes
        </Link>
      </p>
      <button
        type="button"
        onClick={() => {
          applyPalette("current");
          writePalette("off");
          setShown(false);
        }}
        className="btn btn-sm btn-ghost"
      >
        Hide
      </button>
    </div>
  );
}
