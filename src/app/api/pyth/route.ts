import { NextResponse, type NextRequest } from "next/server";

import { bareFeed, hermes, isFeedId } from "@/lib/hermes.server";

export const dynamic = "force-dynamic";

/* The signed Pyth update for a boundary: for each feed, the first price
 * published at or after `t`. This is what a browser posts to settle a fight
 * itself. The data is public and signed; the key only buys access to it.
 *
 * Each parsed entry is checked against the rule the program enforces,
 * prev_publish_time < t <= publish_time, so a caller learns now, not after a
 * wallet popup and a failed transaction, if Hermes handed back anything else. */
export async function GET(req: NextRequest) {
  const feeds = (req.nextUrl.searchParams.get("feeds") ?? "").split(",").filter(Boolean);
  const t = Number(req.nextUrl.searchParams.get("t"));

  if (!feeds.length || feeds.length > 4 || !feeds.every(isFeedId)) {
    return NextResponse.json({ error: "Pass 1 to 4 Pyth feed ids as ?feeds=" }, { status: 400 });
  }
  if (!Number.isInteger(t) || t <= 0) {
    return NextResponse.json({ error: "Pass a unix timestamp as ?t=" }, { status: 400 });
  }
  if (t > Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "That boundary is in the future." }, { status: 425 });
  }

  try {
    const res = await hermes().getPriceUpdatesAtTimestamp(t, feeds.map(bareFeed), {
      encoding: "base64",
      parsed: true,
    });
    const parsed = (res.parsed ?? []).map((p) => {
      const prev = p.metadata?.prev_publish_time ?? null;
      return {
        id: bareFeed(p.id),
        price: String(p.price.price),
        expo: p.price.expo,
        publishTime: p.price.publish_time,
        prevPublishTime: prev,
        firstAfterBoundary: prev !== null && prev < t && t <= p.price.publish_time,
      };
    });
    if (parsed.length < feeds.length) {
      return NextResponse.json(
        { error: "Pyth has not published after that boundary for every feed yet. Is the market open?" },
        { status: 404 },
      );
    }
    return NextResponse.json({ binary: res.binary.data, parsed });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Hermes request failed";
    const status = /404|not found/i.test(error) ? 404 : 503;
    return NextResponse.json({ error }, { status });
  }
}
