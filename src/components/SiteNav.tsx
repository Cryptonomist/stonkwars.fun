"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/Logo";
import { WalletButton } from "@/components/WalletButton";
import { FaucetButton } from "@/components/FaucetButton";
import { MarketBadge } from "@/components/MarketBadge";
import { CLUSTER } from "@/lib/stocks";

const LINKS = [
  { href: "/fights", label: "Fights" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" aria-label="Stonk Wars home" className="shrink-0">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 font-display text-base font-extrabold uppercase tracking-wide ${
                path?.startsWith(l.href) ? "text-ink" : "text-dim hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <MarketBadge className="hidden md:flex" />
          {CLUSTER !== "mainnet-beta" ? <FaucetButton className="hidden sm:block" /> : null}
          <Link href="/new" className="btn btn-sm btn-p1 hidden sm:inline-flex">
            Pick a fight
          </Link>
          <WalletButton />
        </div>
      </div>
      <nav className="flex items-center gap-1 border-t border-line px-2 py-1.5 sm:hidden">
        {[...LINKS, { href: "/new", label: "Pick a fight" }].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 px-2 py-1 text-center font-display text-sm font-extrabold uppercase ${
              path?.startsWith(l.href) ? "text-ink" : "text-dim"
            }`}
          >
            {l.label}
          </Link>
        ))}
        {CLUSTER !== "mainnet-beta" ? <FaucetButton compact /> : null}
      </nav>
    </header>
  );
}
