import type { Metadata } from "next";

import { Plate } from "@/components/ui/Plate";
import { PaletteChoice } from "./PaletteChoice";

/* A temporary page for one decision: whether cyan and pink are doing too much
 * work across the site. Not linked from anywhere and not indexed. Delete it
 * with components/PaletteLab.tsx, lib/paletteLab.ts and the calm block in
 * globals.css once the choice is made. */

export const metadata: Metadata = {
  title: "Palette preview",
  robots: { index: false, follow: false },
};

export default function PalettePage() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <Plate as="header" notch pad="std" className="flex flex-col gap-2">
        <p className="label">Preview</p>
        <h1 className="display text-hud-lg text-ink">Two palettes</h1>
        <p className="max-w-prose text-sm text-dim">
          Cyan and pink were doing three jobs: a fighter&apos;s corner, every primary button on the site, and buy and
          sell in the trade panel. Only the first is what they were picked for. Pick one below and the whole site
          changes under you, for this browser tab only. Nothing is saved and nobody else sees it.
        </p>
      </Plate>
      <PaletteChoice />
    </div>
  );
}
