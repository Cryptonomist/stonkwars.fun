import type { Metadata } from "next";
import { Suspense } from "react";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { DEVNET_SITE, FIGHTS_LIVE } from "@/lib/deployment";

import { CreateFight } from "./CreateFight";
import { pageMeta } from "@/lib/pageMeta";

export const metadata: Metadata = pageMeta(
  "Pick a fight",
  "Pick your stock and the one it beats, set the stake and the round, and send the link. Whoever takes it stakes the other side.",
  "/new",
);

/* The ticket reads its fighters from the link (useSearchParams), so the page
 * renders in the browser and the server sends only this. It is the page's own
 * shape, picker beside ticket, so nothing jumps when the real one lands, and it
 * holds no number: a price or a stake shown before one was read would be a
 * value that never existed. */
function Loading() {
  return (
    <div className="pb-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <PageHeader eyebrow="New fight" title="Pick a fight" className="pb-2" />
      <Skeleton className="mb-6 h-3 w-full max-w-xl" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
          <Skeleton className="h-10 w-full sm:max-w-xs" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </div>
        <div className="card flex min-w-0 flex-col gap-4 p-4">
          <div className="flex justify-between gap-3">
            <Skeleton className="h-24 w-28" />
            <Skeleton className="h-24 w-28" />
          </div>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function NewFightPage() {
  /* On the mainnet deployment there is no program to create a fight with, and
   * no faucet or sparring wallet either, so the picker would build a ticket
   * nothing could accept. Send them to the site where fights actually run
   * rather than render a button that cannot work. */
  if (!FIGHTS_LIVE) {
    return (
      <div className="py-6">
        <Notice
          title="Fights run on the devnet site."
          action={
            <a href={DEVNET_SITE} className="btn btn-sm btn-primary">
              Go and fight, free &rarr;
            </a>
          }
        >
          This deployment is for trading real tokenized stocks in your own wallet. The fight program is deployed on
          devnet, where the shares are free and there is always somebody to fight, so nothing here needs funding.
        </Notice>
      </div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <CreateFight />
    </Suspense>
  );
}
