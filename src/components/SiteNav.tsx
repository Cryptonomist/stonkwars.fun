"use client";

/* The header: who this is, where to go, what to do.
 *
 * THREE ZONES, ONE OF WHICH GIVES. The wordmark is on the left, the places to
 * go take the middle, and the tools and the wallet sit on the right. Only the
 * middle zone is elastic, and it is the only one that is clipped: the right
 * zone cannot be squeezed under its own contents, which is what used to happen.
 * The row was budgeted by hand for three links, two more were added later, and
 * at every desktop width the search box printed itself on top of How it works
 * while the wallet ran under the edge of the window. A clipped middle and a
 * right zone that never shrinks makes that overlap impossible, with or without
 * the script below.
 *
 * WHAT FITS IS MEASURED, NOT GUESSED. Every piece that can give is left in the
 * row and parked out of the flow when it is not wanted, so its real width can
 * always be read; a ResizeObserver reports the row, and lib/navfit.ts decides.
 * The order things give in is a ranking, not an accident:
 *
 *   the page somebody is on   never
 *   Fights, Trade             last
 *   Leaderboard
 *   the market's session      ambient, so it goes before a place to go
 *   the faucet                a step, and the wallet menu offers it as well
 *   Pre-IPO, How it works     into MORE, where they are still one click away
 *   the word on search        first: the glyph says the same thing in 40px
 *
 * Nothing that is a place to go is ever hidden; it folds into MORE. Only the
 * two readouts hide, and both say what they say elsewhere.
 *
 * Below 640px the middle zone is gone and BottomNav carries the places to go,
 * where a thumb can reach them; Pick a fight stays there up to 768px.
 *
 * The current page is marked in ink with a short slanted underline plate and
 * aria-current, not in a side colour: a page is not a corner. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { SearchGlyph } from "@/components/CommandPalette";
import { FaucetButton, useFaucet } from "@/components/FaucetButton";
import { Wordmark } from "@/components/Logo";
import { MarketBadge } from "@/components/MarketBadge";
import { cx } from "@/components/ui/cx";
import { requestPalette } from "@/components/ui/intents";
import { Kbd } from "@/components/ui/Kbd";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { WalletButton } from "@/components/WalletButton";
import { fitRow, type Fit, type Fold, type Slot } from "@/lib/navfit";
import { CLUSTER } from "@/lib/stocks";

/** The one gap in the row, in px: Tailwind's gap-2. The measuring has to know
 *  it, so it is a number here and a class there, and the two have to agree. */
const GAP = 8;

/** Held back from the budget, for the focus ring on the last link and for the
 *  half-pixels sub-pixel layout leaves behind. */
const SLACK = 4;

/** Shown in this order; given up in rank order, lowest first. */
const LINKS = [
  { href: "/fights", label: "Fights", rank: 90 },
  { href: "/trade", label: "Trade", rank: 80 },
  /* The nav says Pre-IPO and the page says "Not public yet". The page has room
   * to say it plainly, in this site's own words; a nav item has to be the word
   * somebody is already looking for, and every other market for these calls
   * them pre-IPO, this one's URL and its source included. */
  { href: "/pre-ipo", label: "Pre-IPO", rank: 55 },
  { href: "/leaderboard", label: "Leaderboard", rank: 70 },
  { href: "/how", label: "How it works", rank: 50 },
];

const STATUS = "status";
const FAUCET = "faucet";
const SEARCH_WORD = "search-word";

const RANKS: Record<string, { rank: number; fold: Fold; inside?: boolean }> = {
  [STATUS]: { rank: 65, fold: "hide" },
  [FAUCET]: { rank: 58, fold: "menu" },
  /* The word and its key hint live inside the search button, so while they
   * show, their width is part of that button's and must not be counted twice. */
  [SEARCH_WORD]: { rank: 20, fold: "hide", inside: true },
  ...Object.fromEntries(LINKS.map((l) => [l.href, { rank: l.rank, fold: "menu" as Fold }])),
};

const LINK_CLASS =
  "relative flex h-10 items-center whitespace-nowrap px-2.5 font-display text-base font-extrabold uppercase tracking-wide transition-colors";

/** Out of the flow, out of the way, still measurable. */
const PARKED = "pointer-events-none invisible absolute top-0 left-0";

/** A piece the row is allowed to give up. Parked rather than unmounted, so the
 *  next measure still knows what it would cost to bring it back. */
function Fitted({
  slot,
  on,
  watch = false,
  className,
  children,
}: {
  slot: string;
  on: boolean;
  /** Its width changes on its own, not only with the window. */
  watch?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot={slot}
      data-watch={watch ? "" : undefined}
      inert={!on}
      aria-hidden={!on || undefined}
      className={cx("flex shrink-0 items-center", className, !on && PARKED)}
    >
      {children}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
      <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);
const sameFit = (a: Fit | null, b: Fit | null) =>
  !!a && !!b && sameKeys(a.inline, b.inline) && sameKeys(a.menu, b.menu) && sameKeys(a.hidden, b.hidden);

export function SiteNav() {
  const path = usePathname();
  const isHere = useCallback((href: string) => !!path?.startsWith(href), [path]);

  const rowRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const fitRef = useRef<Fit | null>(null);

  /* The faucet again, for the menu: on test clusters it folds in there when the
   * row runs short. */
  const { drip, busy } = useFaucet();

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const box = (el: Element) => el.getBoundingClientRect().width;
    const style = getComputedStyle(row);
    const room = row.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");

    /* What the pieces that never move have taken, with their gaps. A breakpoint
     * may have any of them off this screen, and then it costs nothing: Pick a
     * fight is BottomNav's below 768px. */
    const anchors = Array.from(row.querySelectorAll<HTMLElement>("[data-anchor]")).filter((el) => box(el) > 0);
    let taken = anchors.reduce((t, el) => t + box(el), 0) + GAP * Math.max(0, anchors.length - 1);

    const slots: Slot[] = [];
    for (const el of Array.from(row.querySelectorAll<HTMLElement>("[data-slot]"))) {
      const key = el.dataset.slot ?? "";
      const spec = RANKS[key];
      const width = box(el);
      /* Nothing to measure: a breakpoint has it off this screen, so it is not
       * competing for the row and fitting cannot bring it back. */
      if (!spec || width === 0) continue;
      if (spec.inside && getComputedStyle(el).position !== "absolute") taken -= width + GAP;
      slots.push({ key, width, rank: spec.rank, fold: spec.fold, pinned: isHere(key) });
    }

    const more = row.querySelector<HTMLElement>("[data-more]");
    const next = fitRow(slots, {
      available: room - taken - SLACK,
      gap: GAP,
      moreWidth: more ? box(more) : 0,
    });
    if (sameFit(next, fitRef.current)) return;
    fitRef.current = next;
    setFit(next);
  }, [isHere]);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const watching = new ResizeObserver(() => measure());
    watching.observe(row);
    /* The wallet turns from Connect into an address, and the session line is
     * not there at all until the page has a clock. Both change what is left
     * for everything else, and neither is a window resize. */
    for (const el of Array.from(row.querySelectorAll("[data-watch]"))) watching.observe(el);
    /* The window as well: an observer hands its callbacks to the frame loop,
     * and a page that is not being painted (a background tab) has no frames
     * until somebody looks at it. A resize still arrives. */
    window.addEventListener("resize", measure);
    return () => {
      watching.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    /* Every width in here is a width of type, and the display faces land after
     * the first paint. */
    document.fonts?.ready.then(measure).catch(() => {});
  }, [measure]);

  /* Before the first measure, and with no script at all: every place to go is
   * on the row, and only the word on the search button is held back. The middle
   * zone is clipped, so even that render cannot overlap anything. */
  const shown = (key: string) => (fit ? fit.inline.includes(key) : key !== SEARCH_WORD);
  const foldedIn = (key: string) => (fit ? fit.menu.includes(key) : false);
  const searchWorded = shown(SEARCH_WORD);

  const inMenu = LINKS.filter((l) => foldedIn(l.href));
  const faucetInMenu = CLUSTER !== "mainnet-beta" && foldedIn(FAUCET);
  const anythingInMenu = inMenu.length > 0 || faucetInMenu;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
      <div ref={rowRef} className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Link href="/" aria-label="Stonk Wars home" data-anchor className="shrink-0">
          <Wordmark />
        </Link>

        {/* WHERE TO GO: the row's elastic, and the only part of it that clips. */}
        <nav aria-label="Main" className="relative hidden min-w-0 flex-1 items-center gap-2 overflow-hidden sm:flex">
          {LINKS.map((l) => {
            const here = isHere(l.href);
            return (
              <Fitted key={l.href} slot={l.href} on={shown(l.href)}>
                <Link
                  href={l.href}
                  aria-current={here ? "page" : undefined}
                  className={cx(LINK_CLASS, here ? "text-ink" : "text-dim hover:text-ink")}
                >
                  {l.label}
                  {here ? (
                    <span
                      aria-hidden="true"
                      className="plate absolute inset-x-2.5 bottom-1 h-0.5 bg-ink"
                      style={{ ["--slant" as string]: "2px" }}
                    />
                  ) : null}
                </Link>
              </Fitted>
            );
          })}

          {/* Whatever the row could not hold. Parked while it holds everything,
            * because the fit has to know what this button would cost. */}
          <div
            data-more
            inert={!anythingInMenu}
            aria-hidden={!anythingInMenu || undefined}
            className={cx("flex shrink-0 items-center", !anythingInMenu && PARKED)}
          >
            <Menu
              align="start"
              triggerClassName={cx(LINK_CLASS, "gap-1.5 text-dim hover:text-ink")}
              trigger={
                <>
                  More
                  <ChevronDown />
                </>
              }
            >
              {inMenu.map((l) => (
                <MenuItem key={l.href} href={l.href}>
                  {l.label}
                </MenuItem>
              ))}
              {faucetInMenu ? (
                <MenuItem onSelect={() => void drip()} disabled={busy}>
                  {busy ? "Minting..." : "Get test shares"}
                </MenuItem>
              ) : null}
            </Menu>
          </div>
        </nav>

        {/* WHAT TO DO: never shrinks, never clipped. */}
        <div className="relative flex shrink-0 items-center gap-2">
          <Fitted slot={STATUS} on={shown(STATUS)} watch className="hidden md:flex">
            <MarketBadge />
          </Fitted>

          <button
            type="button"
            onClick={requestPalette}
            aria-label="Search stocks, fighters and fights"
            aria-keyshortcuts="/ Control+K Meta+K"
            data-anchor
            className={cx(
              "relative flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 px-2 text-dim transition-colors hover:text-ink",
              searchWorded && "bg-panel-2 pr-1.5 pl-2.5 ring-1 ring-line ring-inset hover:ring-line-strong",
            )}
          >
            <SearchGlyph className="shrink-0" />
            <span
              data-slot={SEARCH_WORD}
              inert={!searchWorded}
              aria-hidden={!searchWorded || undefined}
              className={cx("flex items-center gap-1.5 text-sm", !searchWorded && PARKED)}
            >
              Search
              <Kbd>/</Kbd>
            </span>
          </button>

          {CLUSTER !== "mainnet-beta" ? (
            <Fitted slot={FAUCET} on={shown(FAUCET)} className="hidden md:flex">
              <FaucetButton className="whitespace-nowrap" />
            </Fitted>
          ) : null}

          <Link href="/new" data-anchor className="btn btn-sm btn-primary hidden whitespace-nowrap md:inline-flex">
            Pick a fight
          </Link>

          <div data-anchor data-watch className="shrink-0">
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}
