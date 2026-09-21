import type { Metadata } from "next";

import { ExhibitionDesk } from "./ExhibitionDesk";
import { pageMeta } from "@/lib/pageMeta";

export const metadata: Metadata = pageMeta(
  "Exhibition",
  "Put OpenAI, Anthropic or another company that has not listed yet against a listed stock over the same window and see who would have won. Real prices, no stake, nothing on chain.",
  "/exhibition",
);

export default async function ExhibitionPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  return <ExhibitionDesk initialA={(a ?? "").toUpperCase()} initialB={(b ?? "").toUpperCase()} />;
}
