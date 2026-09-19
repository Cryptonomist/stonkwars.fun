import type { Metadata } from "next";

import { ExhibitionDesk } from "./ExhibitionDesk";

export const metadata: Metadata = {
  title: "Exhibition",
  description:
    "Put OpenAI, Anthropic or another company that has not listed yet against a listed stock over the same window and see who would have won. Real prices, no stake, nothing on chain.",
};

export default async function ExhibitionPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  return <ExhibitionDesk initialA={(a ?? "").toUpperCase()} initialB={(b ?? "").toUpperCase()} />;
}
