import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { BRAND } from "@/lib/brand";
import { byTicker, type Stock } from "@/lib/stocks";

import { StockView } from "./StockView";

type Props = { params: Promise<{ ticker: string }> };

/* A STOCK'S OWN PAGE: /s/NVDA.
 *
 * Every one of the roster's stocks gets one, stakeable here or not, because
 * the tape, the movers and the search all name stocks and a name should lead
 * somewhere. Anything off the roster is the site's 404: there is no page for a
 * stock nothing here can price.
 *
 * Tickers are written in capitals everywhere on the site, so /s/nvda is sent
 * to /s/NVDA rather than kept as a second address for the same page. */

function stockFor(raw: string): Stock | undefined {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* A malformed escape is not a ticker; the lookup below misses it. */
  }
  return byTicker(decoded) ?? byTicker(decoded.toUpperCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const stock = stockFor(ticker);
  if (!stock) return { title: "Not found", robots: { index: false } };
  const title = `${stock.ticker} · ${stock.name}`;
  const description = `${stock.name} (${stock.ticker}) on ${BRAND.name}: live price with its source, today's minute chart, and its record in fights settled on Solana.`;
  /* Next replaces the layout's twitter object rather than merging it, so the
   * card type and site handle are restated or X falls back to the small card. */
  return {
    title,
    description,
    openGraph: { title: `${title} · ${BRAND.name}`, description },
    twitter: { card: "summary_large_image", site: BRAND.x, title, description },
  };
}

export default async function StockPage({ params }: Props) {
  const { ticker } = await params;
  const stock = stockFor(ticker);
  if (!stock) notFound();
  if (stock.ticker !== ticker) redirect(`/s/${encodeURIComponent(stock.ticker)}`);

  /* The fallback is the page's own shape, header then chart beside the rail,
   * and holds no number: a price shown before one was read never existed. */
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 py-6" aria-busy="true">
          <Skeleton className="h-44 w-full sm:h-36" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Skeleton className="h-72 w-full" />
              <SkeletonRows kind="fight" rows={2} />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          </div>
        </div>
      }
    >
      <StockView ticker={stock.ticker} />
    </Suspense>
  );
}
