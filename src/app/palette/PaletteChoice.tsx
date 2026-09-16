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

/* Four steps, each the one before it plus a little more, so the question is
 * only ever how far to go rather than which direction. */
const WHAT: { id: Palette; name: string; blurb: string; changes: string[] }[] = [
  {
    id: "current",
    name: "Current",
    blurb: "The site as it is today.",
    changes: [
      "Cyan is side one, and also every primary button",
      "Cyan and pink are buy and sell in the trade panel",
      "Every ticker is painted by its side, everywhere",
      "Live things glow at 0.35",
    ],
  },
  {
    id: "middle",
    name: "Middle",
    blurb: "Take away the meanings that were never sides. Buttons keep their rank.",
    changes: [
      "Buy and sell go to the green and red every price already uses",
      "Glows come down to 0.18",
      "Cyan stays on the action on a screen, where it outranks the rest",
      "Tickers are untouched",
    ],
  },
  {
    id: "calm",
    name: "Calm",
    blurb: "Middle, plus cyan off the buttons.",
    changes: [
      "Everything middle does",
      "The action on a screen goes to ink, so cyan stops meaning press this",
      "Cyan and pink then mean a side of a fight and nothing else",
      "Tickers are still untouched, which is why this changes less than it sounds",
    ],
  },
  {
    id: "quiet",
    name: "Quiet",
    blurb: "Calm, plus the thing the other two barely touch.",
    changes: [
      "Everything calm does",
      "A ticker's name is softened wherever it is only text",
      "Fills, health bars and chart lines stay at full strength",
      "This is where nearly all the colour on a screen actually is",
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          Two things to watch for. Ink is already the colour of buttons like Get test shares, so a primary button in ink
          stops outranking them in the nav: that is what middle keeps and calm gives up. And nearly every coloured word
          on a board is a ticker rather than a button, which is why only quiet moves the needle much. Whichever you
          pick, say so and the rest gets deleted.
        </p>
      </Plate>
    </div>
  );
}
