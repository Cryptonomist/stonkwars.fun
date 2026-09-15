import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { avatarUrlFor } from "@/lib/avatar.server";
import { cleanAvatar } from "@/lib/xLink";

export const dynamic = "force-dynamic";

/* The picture beside a handle, served from here rather than hotlinked, so a
 * visitor's browser never talks to X just by opening a leaderboard.
 *
 * Only a URL the chain carries (lib/avatar.server) is fetched, and only from
 * X's image host (lib/xLink cleanAvatar), so this cannot be pointed anywhere
 * else. A wallet with no picture is a 404, which the page turns back into its
 * identicon. */

const MAX_BYTES = 1_500_000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  let key: PublicKey;
  try {
    key = new PublicKey(wallet);
  } catch {
    return none(400);
  }

  const url = cleanAvatar(await avatarUrlFor(key));
  if (!url) return none(404);

  try {
    const res = await fetch(url, { cache: "no-store", redirect: "error" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return none(404);
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return none(404);
    return new NextResponse(body, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return none(502);
  }
}

/* Short, because "no picture" stops being true the moment somebody links. */
const none = (status: number) =>
  new NextResponse(null, { status, headers: { "cache-control": "public, max-age=30, s-maxage=30" } });
