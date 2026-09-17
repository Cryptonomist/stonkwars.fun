import type { Metadata } from "next";

import { PreIpoDesk } from "./PreIpoDesk";

export const metadata: Metadata = {
  title: "Not public yet",
  /* Not "buy OpenAI". What is bought is a PreStocks token issued against a
   * holding in the company, which is what the page says in its own fine print.
   * A description promising the share and a page saying it is not the share
   * cannot both be right. */
  description:
    "Buy tokens that track OpenAI, Anthropic, Neuralink and other private companies, on Solana at any hour. Live routed quotes, in your own wallet.",
};

export default async function PreIpoPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return <PreIpoDesk initial={(t ?? "").toUpperCase()} />;
}
