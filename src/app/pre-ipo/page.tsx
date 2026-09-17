import type { Metadata } from "next";

import { PreIpoDesk } from "./PreIpoDesk";

export const metadata: Metadata = {
  title: "Not public yet",
  description:
    "Buy OpenAI, Anthropic, Neuralink and other private companies on Solana, at any hour. Live routed quotes, in your own wallet.",
};

export default async function PreIpoPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return <PreIpoDesk initial={(t ?? "").toUpperCase()} />;
}
