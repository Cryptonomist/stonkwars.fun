import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonRows } from "@/components/ui/Skeleton";

import { FightsBoard } from "./FightsBoard";

export const metadata: Metadata = {
  title: "Fights",
  description: "Every stock fight on chain: rounds live now, open challenges, and results by day.",
};

/* The tab and the filters live in the query string, and reading it opts the
 * board out of static rendering up to this boundary. The fallback is the
 * board's own shape, so nothing jumps when the chain answers. */
export default function FightsPage() {
  return (
    <Suspense
      fallback={
        <div className="pb-6">
          <PageHeader eyebrow="On chain" title="Fights" />
          <SkeletonRows kind="fight" rows={8} />
        </div>
      }
    >
      <FightsBoard />
    </Suspense>
  );
}
