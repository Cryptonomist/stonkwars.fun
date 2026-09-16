"use client";

/* TWO PALETTES, ON THE REAL SITE, WITH A SWITCH.
 *
 * The question this answers is whether cyan and pink are doing too much work.
 * A mock-up cannot answer it, because the thing being judged is the weight of a
 * colour across a whole site: the nav, a board of fights, a live round, the
 * trade desk. So the switch rides along on the real pages and swaps the palette
 * under them.
 *
 * WHAT IT SWAPS is in globals.css under [data-palette="calm"], and it is not a
 * new set of hues. Cyan and pink keep every side of every fight. What they lose
 * is the two other jobs they had picked up: the action on a screen goes to ink,
 * and a buy and a sell go to the same green and red the prices already use. The
 * glows come down from 0.35 to 0.18. That is the whole proposal.
 *
 * NOBODY SEES THIS BY ACCIDENT. The switch appears only after a visit to a URL
 * carrying ?palette, and then only for that browser tab. A visitor who never
 * types it gets the site exactly as it is.
 *
 * Delete this file, its line in layout.tsx and the calm block in globals.css
 * once the choice is made, whichever way it goes. */

import { useEffect, useState } from "react";

import { cx } from "./ui/cx";

const KEY = "sw-palette";
type Palette = "current" | "calm";

/* Session storage throws in a locked-down browser, and a preview tool is never
 * worth a blank page. */
const read = (): string | null => {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (v: string) => {
  try {
    window.sessionStorage.setItem(KEY, v);
  } catch {
    // Nothing to do: the switch still works, it just forgets on the next page.
  }
};

export function PaletteLab() {
  const [shown, setShown] = useState(false);
  const [palette, setPalette] = useState<Palette>("current");

  /* Read once on mount rather than through useSearchParams, which would put
   * every page in the app behind a Suspense boundary for a preview tool.
   *
   * The stored value is the palette itself, or "off" after a Hide. A visitor
   * who has never asked has nothing stored and sees nothing; ?palette opens the
   * switch again even after a Hide, which is the only way back. */
  useEffect(() => {
    const stored = read();
    const asked = new URLSearchParams(window.location.search).has("palette");
    if (!asked && (stored === null || stored === "off")) return;
    const next: Palette = stored === "calm" ? "calm" : "current";
    setShown(true);
    setPalette(next);
    write(next);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    if (palette === "calm") root.dataset.palette = "calm";
    else delete root.dataset.palette;
    write(palette);
  }, [shown, palette]);

  if (!shown) return null;

  const tab = (value: Palette, label: string) => (
    <button
      type="button"
      aria-pressed={palette === value}
      onClick={() => setPalette(value)}
      className={cx("btn btn-sm px-3", palette === value ? "btn-light" : "btn-ghost")}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed bottom-24 left-3 z-50 flex flex-col gap-2 bg-panel-2 p-2 shadow-overlay ring-1 ring-line-strong sm:bottom-4">
      <p className="label px-1 text-dim">Palette</p>
      <div className="flex gap-1">
        {tab("current", "Current")}
        {tab("calm", "Calm")}
      </div>
      <p className="max-w-44 px-1 text-micro text-dim">
        Calm keeps cyan and pink for the two sides of a fight and takes them off buttons that only mean press this.
        Browse the site with it on.
      </p>
      <button
        type="button"
        onClick={() => {
          delete document.documentElement.dataset.palette;
          write("off");
          setShown(false);
        }}
        className="btn btn-sm btn-ghost"
      >
        Hide
      </button>
    </div>
  );
}
