import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonRows } from "@/components/ui/Skeleton";

import { Leaderboard } from "./Leaderboard";

export const metadata: Metadata = { title: "Leaderboard" };

/* The range tab lives in the query string, and reading it opts the board out
 * of static rendering up to this boundary. The fallback is the board's own
 * shape, so nothing jumps when the chain answers. */
export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <div className="pb-6">
          <PageHeader eyebrow="Settled on chain" title="Leaderboard" />
          <SkeletonRows kind="fighter" rows={8} />
        </div>
      }
    >
      <Leaderboard />
    </Suspense>
  );
}
