import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

import { CreateFight } from "./CreateFight";

export const metadata: Metadata = { title: "Pick a fight" };

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
  return (
    <Suspense fallback={<Loading />}>
      <CreateFight />
    </Suspense>
  );
}
