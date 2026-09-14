import type { Metadata } from "next";
import { Suspense } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

import { FightView } from "./FightView";
import { decodeDuel, PROGRAM_ID } from "@/lib/duel";
import { shares } from "@/lib/format";
import { isListedDuel, STAKE_DECIMALS, tickerForMint } from "@/lib/stocks";
import { BRAND } from "@/lib/brand";

type Props = { params: Promise<{ duel: string }> };

/* The title a link unfurls with. One RPC read, bounded, and a generic title if
 * it is slow or the account is gone: a share preview must never hang a page. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { duel } = await params;
  try {
    const key = new PublicKey(duel);
    const conn = new Connection(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com");
    const info = await Promise.race([
      conn.getAccountInfo(key),
      new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
    ]);
    if (!info || !info.owner.equals(PROGRAM_ID)) return { title: "Fight" };
    const d = decodeDuel(key, info.data);
    /* An old test fight on a mint that is not a listed stock would unfurl as
     * "? vs ?". Name it for what it is; the page itself still loads. */
    const listed = isListedDuel(d);
    const t1 = tickerForMint(d.creatorMint) ?? "?";
    const t2 = tickerForMint(d.opponentMint) ?? "?";
    const title = listed ? `${t1} vs ${t2}` : "Retired test fight";
    const description = !listed
      ? `A fight staked in test tokens, not listed stocks, on ${BRAND.name}.`
      : d.taunt
        ? `"${d.taunt}" ${shares(d.creatorAmount, STAKE_DECIMALS)} ${t1}x vs ${shares(d.opponentAmount, STAKE_DECIMALS)} ${t2}x on ${BRAND.name}.`
        : `${shares(d.creatorAmount, STAKE_DECIMALS)} ${t1}x vs ${shares(d.opponentAmount, STAKE_DECIMALS)} ${t2}x. Bigger move at the bell takes both.`;
    /* Next replaces the layout's twitter object rather than merging it, so the
     * card type and site handle are restated here or X falls back to the small
     * summary card instead of the large VS image. */
    return {
      title,
      description,
      openGraph: { title: `${title} · ${BRAND.name}`, description },
      twitter: { card: "summary_large_image", site: BRAND.x, title, description },
    };
  } catch {
    return { title: "Fight" };
  }
}

export default async function FightPage({ params }: Props) {
  const { duel } = await params;
  return (
    <Suspense>
      <FightView address={duel} />
    </Suspense>
  );
}
