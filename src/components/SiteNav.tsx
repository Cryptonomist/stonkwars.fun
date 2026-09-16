"use client";

/* The header.
 *
 * From 640px up it carries the places to go, search, the market's session, the
 * faucet on test clusters, the next step (Pick a fight) and the wallet; the
 * less essential pieces drop out as the width runs short, so it never wraps or
 * pushes the page sideways. The steps were measured with a connected wallet
 * and a 15px classic scrollbar: 768 fits the links, the search icon, Pick a
 * fight and the wallet; 1024 adds How it works and the faucet; 1280 adds the
 * worded search box and the market's session, with about 20px to spare when
 * the exchange is shut and the session line is at its longest. Below 640px it
 * is only the wordmark, a search button and the wallet: the places to go move
 * to BottomNav, where a thumb can reach them. Between 640 and 767 the header
 * shows its links but has no room for Pick a fight, so BottomNav stays up to
 * 767px (md) and carries it there.
 *
 * The current page is marked in ink with a short slanted underline plate and
 * aria-current, not in a side colour: a page is not a corner. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SearchGlyph } from "@/components/CommandPalette";
import { FaucetButton } from "@/components/FaucetButton";
import { Wordmark } from "@/components/Logo";
import { MarketBadge } from "@/components/MarketBadge";
import { cx } from "@/components/ui/cx";
import { requestPalette } from "@/components/ui/intents";
import { Kbd } from "@/components/ui/Kbd";
import { WalletButton } from "@/components/WalletButton";
import { CLUSTER } from "@/lib/stocks";

const LINKS = [
  { href: "/fights", label: "Fights" },
  { href: "/trade", label: "Trade" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how", label: "How it works" },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4">
        <Link href="/" aria-label="Stonk Wars home" className="shrink-0">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden items-center sm:flex">
          {LINKS.map((l) => {
            const current = !!path?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "relative flex h-10 items-center whitespace-nowrap px-2.5 font-display text-base font-extrabold uppercase tracking-wide transition-colors",
                  current ? "text-ink" : "text-dim hover:text-ink",
                  l.href === "/how" && "hidden lg:flex",
                )}
              >
                {l.label}
                {current ? (
                  <span
                    aria-hidden="true"
                    className="plate absolute inset-x-2.5 bottom-1 h-0.5 bg-ink"
                    style={{ ["--slant" as string]: "2px" }}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={requestPalette}
            aria-label="Search stocks, fighters and fights"
            aria-keyshortcuts="/ Control+K Meta+K"
            className="flex h-10 min-w-10 items-center justify-center gap-2 px-2 text-dim ring-line transition-colors hover:text-ink xl:bg-panel-2 xl:pr-1.5 xl:pl-2.5 xl:ring-1 xl:ring-inset xl:hover:ring-line-strong"
          >
            <SearchGlyph className="shrink-0" />
            <span className="hidden text-sm xl:inline">Search</span>
            {/* Wrapped, because Kbd sets its own display and a utility on it
              * would fight that rather than override it. */}
            <span className="ml-1 hidden xl:inline-flex">
              <Kbd>/</Kbd>
            </span>
          </button>
          <MarketBadge className="hidden xl:inline-flex" />
          {CLUSTER !== "mainnet-beta" ? <FaucetButton className="hidden lg:inline-flex" /> : null}
          <Link href="/new" className="btn btn-sm btn-p1 hidden whitespace-nowrap md:inline-flex">
            Pick a fight
          </Link>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
