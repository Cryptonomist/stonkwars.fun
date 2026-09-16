import Link from "next/link";
import type { ReactNode } from "react";

import { MarketBadge } from "@/components/MarketBadge";
import { Wordmark } from "@/components/Logo";
import { Badge } from "@/components/ui/Badge";
import { MailIcon, SolanaMark, XLogo } from "@/components/ui/BrandIcons";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { BRAND } from "@/lib/brand";
import { PROGRAM_ID } from "@/lib/duel";
import { AROUND_THE_CLOCK, CLUSTER } from "@/lib/stocks";

/* THE FOOTER: WHERE TO GO NEXT, WHO WE ARE, AND WHAT HOLDS THE MONEY.
 *
 * It used to be one line of links with the letter X standing in for a logo.
 * A product people trust ends every page the same way: the brand and one
 * obvious next step, the whole map of the site in a few short columns, the
 * real accounts to reach it (the X mark, not the letter), and the facts that
 * make it safe to use: which chain, the program that holds every stake, one
 * click from its account on Explorer, and what is and is not at stake.
 *
 * Every link goes somewhere that exists. There is no Discord or Telegram here
 * because there is none; add one to CONTACT when there is.
 *
 * On a phone the fixed bottom bar sits over the end of the page, so the footer
 * reserves its height (--bottom-nav-h, zero from 768px up) below its own
 * content. That keeps the last line of every page clear of the bar without
 * adding a gap between a page and its footer. */

const CLUSTER_NAME: Record<typeof CLUSTER, string> = {
  devnet: "Solana devnet",
  localnet: "Solana localnet",
  "mainnet-beta": "Solana mainnet",
};

const X_URL = `https://x.com/${BRAND.x.replace(/^@/, "")}`;

/* The picker on its Live 24/7 filter, the same URL as MarketBadge's
 * LIVE_247_HREF. Written out rather than imported: this is a server
 * component, and a plain value exported from a "use client" file arrives here
 * as a client reference, not a string, which failed the prerender. */
const LIVE_247_HREF = "/new?filter=247";
const EMAIL = `hello@${BRAND.domain}`;

type FooterLink = { label: string; href: string; extra?: ReactNode };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Play",
    links: [
      { label: "Pick a fight", href: "/new" },
      {
        label: "Live 24/7",
        href: LIVE_247_HREF,
        extra: AROUND_THE_CLOCK > 0 ? <Badge variant="neutral">{AROUND_THE_CLOCK}</Badge> : null,
      },
      { label: "All fights", href: "/fights" },
      { label: "Leaderboard", href: "/leaderboard" },
    ],
  },
  {
    title: "Stocks",
    links: [
      { label: "NVIDIA", href: "/s/NVDA" },
      { label: "Tesla", href: "/s/TSLA" },
      { label: "Apple", href: "/s/AAPL" },
      { label: "S&P 500 (SPY)", href: "/s/SPY" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How it works", href: "/how" },
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
      { label: EMAIL, href: `mailto:${EMAIL}` },
    ],
  },
];

/** A square, slanted, one-colour button for an account elsewhere. */
function SocialButton({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      aria-label={external ? `${label}, opens in a new tab` : label}
      title={label}
      className="plate inline-flex h-10 w-11 items-center justify-center bg-panel-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-panel-3 focus-visible:shadow-[inset_0_0_0_2px_var(--color-void),inset_0_0_0_4px_var(--color-ink)] focus-visible:outline-none"
    >
      {children}
    </a>
  );
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="label">{title}</h2>
      <ul className="flex flex-col gap-2.5">
        {links.map((l) => (
          <li key={l.href} className="flex min-w-0 items-center gap-2">
            {l.href.startsWith("mailto:") ? (
              <a href={l.href} className="truncate text-sm text-dim transition-colors hover:text-ink">
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="truncate text-sm text-dim transition-colors hover:text-ink">
                {l.label}
              </Link>
            )}
            {l.extra}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="rope mt-16 bg-panel pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-7xl px-4">
        {/* The brand, the next step, and the map. */}
        <div className="grid gap-10 py-10 md:grid-cols-12 md:gap-8 lg:py-12">
          <div className="flex min-w-0 flex-col gap-5 md:col-span-5 lg:col-span-4">
            <Link href="/" aria-label={`${BRAND.name} home`} className="self-start">
              <Wordmark />
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-dim">
              {BRAND.tagline} Stake tokenized shares against someone else&apos;s pick; the bigger move takes both
              stakes, settled on Solana with a receipt anyone can check.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/new" className="btn btn-sm btn-primary">
                Pick a fight
              </Link>
              <SocialButton href={X_URL} label={`${BRAND.name} on X (${BRAND.x})`}>
                <XLogo size={17} />
              </SocialButton>
              <SocialButton href={`mailto:${EMAIL}`} label={`Email ${EMAIL}`}>
                <MailIcon size={18} />
              </SocialButton>
            </div>
          </div>

          <nav aria-label="Footer" className="grid min-w-0 grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7 lg:col-span-6 lg:col-start-7">
            {COLUMNS.map((c) => (
              <FooterColumn key={c.title} {...c} />
            ))}
          </nav>
        </div>

        {/* What holds the money, and on which chain. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line py-5">
          <span className="label inline-flex items-center gap-2 text-ink">
            <SolanaMark size={15} />
            Built on Solana
          </span>
          <Badge variant="neutral">{CLUSTER_NAME[CLUSTER]}</Badge>
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="label">Program</span>
            <ExplorerLink kind="address" value={PROGRAM_ID.toBase58()} className="text-meta" />
          </span>
          <span className="text-meta text-dim">No one holds the stakes but the program.</span>
          <MarketBadge className="inline-flex lg:ml-auto" />
        </div>

        {/* The small print. */}
        <div className="flex flex-col gap-2 border-t border-line py-5 text-meta text-dim md:flex-row md:items-center md:justify-between">
          <span>
            &copy; {year} {BRAND.name}. {BRAND.domain}
          </span>
          <span>
            {CLUSTER === "mainnet-beta"
              ? "Stakes are real tokenized shares. Nothing here is investment advice."
              : "Devnet test shares: nothing real is at stake. Nothing here is investment advice."}
          </span>
        </div>
      </div>
    </footer>
  );
}
