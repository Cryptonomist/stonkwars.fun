"use client";

/* The sound switch in the fight's status strip. Off by default, remembered per
 * viewer (lib/sfx.ts keeps it under SOUND_KEY), and a toggle button that says
 * its state with aria-pressed. The click that turns it on is the gesture the
 * browser needs before any audio may start. */

import { useSyncExternalStore } from "react";

import { cx } from "@/components/ui/cx";
import { setSoundOn, soundOn, subscribeSound } from "@/lib/sfx";

export function SoundToggle({ className }: { className?: string }) {
  const on = useSyncExternalStore(subscribeSound, soundOn, () => false);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Sound"
      onClick={() => setSoundOn(!on)}
      className={cx(
        "micro inline-flex h-10 min-w-10 items-center justify-center gap-1.5 px-2 transition-colors sm:h-8",
        on ? "text-ink" : "text-dim hover:text-ink",
        className,
      )}
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor" />
        {on ? (
          <path d="M10 4.5c1 .8 1.5 1.6 1.5 2.5s-.5 1.7-1.5 2.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M10 5l3 4M13 5l-3 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        )}
      </svg>
      {/* On a phone the glyph says it, so the status line keeps its room. */}
      <span aria-hidden="true" className="hidden sm:inline">
        Sound {on ? "on" : "off"}
      </span>
    </button>
  );
}
