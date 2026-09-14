import Link from "next/link";

import { Mark } from "@/components/Logo";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { BRAND } from "@/lib/brand";
import { PROGRAM_ID } from "@/lib/duel";
import { CLUSTER } from "@/lib/stocks";

/* The footer: which chain this build talks to, the program that holds every
 * stake (one click from its account on Explorer), and the reading pages.
 *
 * On a phone the fixed bottom bar sits over the end of the page, so the footer
 * reserves its height (--bottom-nav-h, zero from 640px up) below its own
 * content. That keeps the last line of every page clear of the bar without
 * adding a gap between a page and its footer. */

const CLUSTER_NAME: Record<typeof CLUSTER, string> = {
  devnet: "Solana devnet",
  localnet: "Solana localnet",
  "mainnet-beta": "Solana mainnet",
};

export function SiteFooter() {
  const x = `https://x.com/${BRAND.x.replace(/^@/, "")}`;
  return (
    <footer className="mt-16 border-t border-line pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-dim lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Mark size={20} />
          <Badge variant="neutral">{CLUSTER_NAME[CLUSTER]}</Badge>
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="label">Program</span>
            <ExplorerLink kind="address" value={PROGRAM_ID.toBase58()} className="text-meta" />
          </span>
          <span className="text-meta">No one holds the stakes but the program.</span>
        </div>
        <nav aria-label="Site" className="flex flex-wrap gap-x-4 gap-y-2 lg:ml-auto">
          <Link href="/how" className="link">
            How it works
          </Link>
          <Link href="/privacy" className="link">
            Privacy
          </Link>
          <Link href="/terms" className="link">
            Terms
          </Link>
          <a href={x} target="_blank" rel="noreferrer" className="link">
            X<span className="sr-only"> ({BRAND.x}), opens in a new tab</span>
          </a>
        </nav>
      </div>
    </footer>
  );
}
