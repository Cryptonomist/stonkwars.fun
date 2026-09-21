import type { Metadata } from "next";

import { PreIpoDesk } from "./PreIpoDesk";
import { pageMeta } from "@/lib/pageMeta";

export const metadata: Metadata = pageMeta(
  /* Not "buy OpenAI". What is bought is a PreStocks token that tracks the
   * company's value, and the page's own fine print says it is not the share and
   * that what stands behind it is the issuer's choice. A description promising
   * the share and a page saying it is not the share cannot both be right. */
  "Not public yet",
  "Live routed quotes for tokens that track OpenAI, Anthropic, Neuralink and other private companies, trading on Solana at any hour, and the way to buy them in your own wallet.",
  "/pre-ipo",
);

export default async function PreIpoPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return <PreIpoDesk initial={(t ?? "").toUpperCase()} />;
}
