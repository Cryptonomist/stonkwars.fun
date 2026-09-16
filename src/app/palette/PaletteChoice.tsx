"use client";

/* THE CHOICE, WITH BOTH ANSWERS ON THE PAGE.
 *
 * Picking one here paints the whole site and follows you off this page, which
 * is the point: a palette is judged on a board of fights and a live round, not
 * on a page about palettes. */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Plate } from "@/components/ui/Plate";
import { cx } from "@/components/ui/cx";
import { applyPalette, paletteOf, readPalette, writePalette, type Palette } from "@/lib/paletteLab";

const WHAT: { id: Palette; name: string; blurb: string; changes: string[] }[] = [
  {
    id: "current",
    name: "Current",
    blurb: "The site as it is today.",
    changes: [
      "Cyan is side one, and also every primary button on the site",
      "Cyan and pink are buy and sell in the trade panel",
      "Live things glow at 0.35",
    ],
  },
  {
    id: "calm",
    name: "Calm",
    blurb: "The same hues, asked to do less. Nothing is recoloured.",
    changes: [
      "Cyan and pink mean a side of a fight and nothing else",
      "The action on a screen goes to ink, so cyan stops meaning press this",
      "Buy and sell go to the green and red every price already uses",
      "Live things glow at 0.18",
    ],
  },
];

export function PaletteChoice() {
  const [palette, setPalette] = useState<Palette>("current");
  const [ready, setReady] = useState(false);

  /* Visiting this page is itself the request, so the switch turns on here and
   * stays on as you move around the site. */
  useEffect(() => {
    const next = paletteOf(readPalette());
    setPalette(next);
    writePalette(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyPalette(palette);
    writePalette(palette);
  }, [ready, palette]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {WHAT.map((opt) => {
          const on = palette === opt.id;
          return (
            <Plate key={opt.id} pad="std" className={cx("flex flex-col gap-3", on && "ring-2 ring-ink")}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="h-section">{opt.name}</h2>
                {on ? <span className="label text-ink">Showing now</span> : null}
              </div>
              <p className="text-sm text-dim">{opt.blurb}</p>
              <ul className="flex flex-col gap-1.5 text-meta text-dim">
                {opt.changes.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span aria-hidden="true" className="text-faint">
                      &middot;
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPalette(opt.id)}
                disabled={on}
                aria-pressed={on}
                className={cx("btn mt-auto w-full", on ? "btn-ghost" : "btn-light")}
              >
                {on ? "Showing now" : `Show ${opt.name.toLowerCase()}`}
              </button>
            </Plate>
          );
        })}
      </div>

      <Plate pad="std" className="flex flex-col gap-3">
        <h2 className="h-section">Now go and look</h2>
        <p className="max-w-prose text-sm text-dim">
          The choice follows you until this tab closes, and a small switch sits in the bottom left of every page so you
          can flip back and forth against the same screen. The pages worth judging it on:
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            ["/", "Home"],
            ["/fights", "The board"],
            ["/trade", "Trade desk"],
            ["/s/TSLA", "A stock"],
            ["/leaderboard", "Leaderboard"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="btn btn-sm btn-ghost">
              {label}
            </Link>
          ))}
        </div>
        <p className="max-w-prose text-meta text-dim">
          One thing to watch for, because it is the real cost of the calm one: ink is already the colour of buttons like
          Get test shares, so a primary button in ink no longer outranks them in the nav. Cyan was doing real work
          there. Whichever way you go, say so and the loser gets deleted.
        </p>
      </Plate>
    </div>
  );
}
