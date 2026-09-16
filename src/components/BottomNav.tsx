"use client";

/* The phone's nav, where the thumb is.
 *
 * Below 640px the header keeps only the wordmark, search and the wallet, and
 * the places to go live here: the board, fights, a fight to pick, the ranks and
 * you. It stays up to 767px, because between 640 and 768 the header has room
 * for its links but not for Pick a fight, and a page there had no way to start
 * a fight. Its height is --bottom-nav-h (set by .has-bottom-nav on the body), which
 * toasts and sticky action bars add to their own bottom offset, and which the
 * footer reserves so nothing on the page ends up underneath it.
 *
 * The Fights tab counts challenges that name the connected wallet and are
 * still open. That reads the duel list, so it runs only while a wallet is
 * connected; without one there is nobody to call out. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState, type ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { requestConnect } from "@/components/ui/intents";
import { calledOut } from "@/lib/derive";
import { allDuels } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
import { useNow } from "@/lib/useNow";

const ITEM =
  "relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 transition-colors focus-visible:-outline-offset-2";

function Item({
  href,
  label,
  icon,
  current,
  count = 0,
  countWords,
  className,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  current: boolean;
  count?: number;
  /** What the count means, read after the label: "2 challenges name you". */
  countWords?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(ITEM, current ? "text-ink" : "text-dim hover:text-ink", className)}
    >
      {/* The current page, marked the way the desktop nav marks it: a short
        * slanted ink plate, here on the bar's top edge where the thumb is not. */}
      {current ? (
        <span
          aria-hidden="true"
          className="plate absolute inset-x-4 top-0 h-0.5 bg-ink"
          style={{ ["--slant" as string]: "2px" }}
        />
      ) : null}
      <span className="relative">
        {icon}
        {count > 0 ? (
          /* The count badge's shape filled in ink: it has to be seen on the
           * bar's panel-2, and it is not a side or a price move. */
          <span
            aria-hidden="true"
            className="micro absolute -top-1.5 left-3 inline-flex h-4.5 min-w-4.5 items-center justify-center bg-ink px-1 text-void"
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className="micro">{label}</span>
      {count > 0 && countWords ? <span className="sr-only">{`, ${countWords}`}</span> : null}
    </Link>
  );
}

export function BottomNav() {
  const path = usePathname() ?? "/";
  const { publicKey } = useWallet();
  /* The first client render matches the server's, which has no wallet: an
   * auto-connect that lands before hydration would otherwise swap the Me
   * button for a link mid-hydrate (see WalletButton on why that bites). */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const me = hydrated ? (publicKey?.toBase58() ?? null) : null;
  const now = useNow(30_000);
  const { data } = useDuels("all", me ? allDuels() : null);
  const calls = me && data && now > 0 ? calledOut(me, data, now).length : 0;

  const at = (prefix: string) => (prefix === "/" ? path === "/" : path.startsWith(prefix));
  const mine = me ? `/u/${me}` : null;

  return (
    <nav
      aria-label="Main"
      /* The hairline is an inset shadow, not a border, so the bar is exactly
       * --bottom-nav-h tall and what reserves that height clears it exactly. */
      className="pb-safe fixed inset-x-0 bottom-0 z-30 bg-panel-2 shadow-[inset_0_1px_0_var(--color-line)] md:hidden"
    >
      <div className="grid h-14 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)] items-center">
        <Item href="/" label="Board" icon={<BoardGlyph />} current={at("/")} />
        <Item
          href="/fights"
          label="Fights"
          icon={<FightsGlyph />}
          current={at("/fights")}
          count={calls}
          countWords={`${calls} open ${calls === 1 ? "challenge names" : "challenges name"} you`}
        />
        {/* On /new the ticket's own bar is the primary, so the centre slot
          * steps down to a plain tab rather than stacking a second cyan call to
          * the same action under it. */}
        {at("/new") ? (
          <Item href="/new" label="New" icon={<NewGlyph />} current className="px-4" />
        ) : (
          <Link href="/new" className="btn btn-sm btn-primary mx-1 h-10 whitespace-nowrap px-4">
            Pick a fight
          </Link>
        )}
        <Item href="/leaderboard" label="Ranks" icon={<RanksGlyph />} current={at("/leaderboard")} />
        {mine ? (
          <Item href={mine} label="Me" icon={<MeGlyph />} current={at(mine)} />
        ) : (
          <button type="button" onClick={requestConnect} className={cx(ITEM, "text-dim hover:text-ink")}>
            <MeGlyph />
            <span className="micro">Me</span>
          </button>
        )}
      </div>
    </nav>
  );
}

/* Glyphs: 18px, drawn in currentColor on a 2px grid so they sit with the mono
 * labels. Decorative; every item has its word under it. */

const glyph = { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": true, fill: "none" } as const;

function BoardGlyph() {
  return (
    <svg {...glyph}>
      <path d="M2 3h14M2 9h14M2 15h14" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function FightsGlyph() {
  return (
    <svg {...glyph}>
      <path d="M3 15 15 3M3 3l12 12" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function NewGlyph() {
  return (
    <svg {...glyph}>
      <path d="M9 2v14M2 9h14" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function RanksGlyph() {
  return (
    <svg {...glyph}>
      <path d="M2 16V10h4v6M7 16V4h4v12M12 16V7h4v9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function MeGlyph() {
  return (
    <svg {...glyph}>
      <path d="M5 2h8v8H5zM2 17c0-3 3-5 7-5s7 2 7 5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
