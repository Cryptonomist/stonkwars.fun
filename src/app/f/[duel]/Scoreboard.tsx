"use client";

/* THE SCOREBOARD: both numbers that decide a live round, on one phone line.
 *
 * On a 375px phone the arena stacks its corners, so the challenger's move sat
 * on the first screen and the answer's about 1,200px further down. Nobody
 * could see both at once, which is the whole fight. Once the arena's centre
 * (the clock and the health bars) has scrolled up under the header, this bar
 * pins itself just below the header with each ticker and its live move, the
 * clock between them, and a 4px pair of health bars beneath.
 *
 * It appears only when the arena's own clock is out of view, so nothing is on
 * screen twice. Position is measured on scroll and resize rather than with an
 * IntersectionObserver, which some embedded browsers never fire.
 *
 * Phones and small tablets only: from 768px the corners sit side by side. The
 * bar repeats what the arena already says, so it is hidden from screen readers
 * rather than announcing a second clock. Tickers are side colours, moves are
 * green or red, and nothing on it moves except the digits. */

import { useEffect, useState } from "react";

import { Move } from "@/components/Ticker";
import { Countdown } from "@/components/ui/Countdown";
import { cx } from "@/components/ui/cx";
import { healthFor, koGap } from "@/lib/health";

/** The sticky header's height: h-14 plus its one-pixel rule (SiteNav). */
const HEADER = "calc(3.5rem + 1px)";
const HEADER_PX = 57;

export function Scoreboard({
  t1,
  t2,
  m1,
  m2,
  endTs,
  now,
  roundSecs,
}: {
  t1: string;
  t2: string;
  m1: number | null;
  m2: number | null;
  endTs: number;
  now: number;
  roundSecs: number;
}) {
  const [show, setShow] = useState(false);

  /* One rectangle read per scroll event, and React skips the render when the
   * answer has not changed, so there is no need to batch into animation
   * frames (which a background tab never runs). */
  useEffect(() => {
    const measure = () => {
      const centre = document.querySelector("[data-arena-center]");
      setShow(centre ? centre.getBoundingClientRect().bottom < HEADER_PX : true);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  if (!show) return null;
  const [h1, h2] = m1 !== null && m2 !== null ? healthFor(m1, m2, koGap(roundSecs)) : [100, 100];

  return (
    <div
      aria-hidden="true"
      data-scoreboard
      className="rope fixed inset-x-0 z-20 border-b border-line bg-panel-2 md:hidden"
      style={{ top: HEADER }}
    >
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 pt-2 pb-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="display shrink-0 text-hud-xs text-p1 normal-case">{t1}</span>
          <Move value={m1} className="num truncate text-sm" />
        </span>
        <Countdown to={endTs} now={now} className="text-sm font-semibold text-ink" />
        <span className="flex min-w-0 flex-row-reverse items-center gap-2">
          <span className="display shrink-0 text-hud-xs text-p2 normal-case">{t2}</span>
          <Move value={m2} className="num truncate text-sm" />
        </span>
      </div>
      <div className="mx-auto flex max-w-7xl gap-2 px-4 pb-2">
        <MiniBar health={h1} side="p1" />
        <MiniBar health={h2} side="p2" />
      </div>
    </div>
  );
}

function MiniBar({ health, side }: { health: number; side: "p1" | "p2" }) {
  return (
    <div className="relative h-1 min-w-0 flex-1 overflow-hidden bg-panel">
      <div
        className={cx("bar-fill absolute inset-y-0", side === "p1" ? "right-0 bg-p1" : "left-0 bg-p2")}
        style={{ width: `${health}%` }}
      />
    </div>
  );
}
