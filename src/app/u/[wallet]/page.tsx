import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PublicKey } from "@solana/web3.js";

import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { BRAND } from "@/lib/brand";
import { shortAddress } from "@/lib/format";

import { ProfileView } from "./ProfileView";
import { readVouchedHandle, serverConnection } from "./readHandle";

type Props = { params: Promise<{ wallet: string }> };

const parse = (s: string): PublicKey | null => {
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
};

/* The title a profile link unfurls with: the handle when the chain vouches for
 * one, else the short address. One bounded read; a slow node gets the address
 * rather than a hung page. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { wallet } = await params;
  const key = parse(wallet);
  if (!key) return { title: "Not a wallet" };
  const handle = await readVouchedHandle(serverConnection(), key, 2_000);
  const title = handle ? `@${handle}` : shortAddress(key.toBase58());
  const description = `${title} on ${BRAND.name}: every fight, result and dollar taken, read from Solana.`;
  /* Next replaces the layout's twitter object rather than merging it, so the
   * card type and site handle are restated or X falls back to the small card. */
  return {
    title,
    description,
    openGraph: { title: `${title} · ${BRAND.name}`, description },
    twitter: { card: "summary_large_image", site: BRAND.x, title, description },
  };
}

export default async function ProfilePage({ params }: Props) {
  const { wallet } = await params;
  const key = parse(wallet);
  if (!key) notFound();
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 py-6">
          <Skeleton className="h-24 w-full" />
          <SkeletonRows kind="fight" rows={4} />
        </div>
      }
    >
      <ProfileView wallet={key.toBase58()} />
    </Suspense>
  );
}
