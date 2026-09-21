import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/brand";
import { ROSTER } from "@/lib/stocks";

/* The pages that exist whoever is looking: the static ones, and a page per
 * stock for the names people search for. The roster is ordered with those
 * first (scripts/build-roster.ts, FEATURED), so the first sixty are the right
 * sixty. Fights and profiles are left out: they are made by the hour, and a
 * fight's own link is how it travels. */
const STATIC = ["/", "/fights", "/new", "/trade", "/pre-ipo", "/exhibition", "/leaderboard", "/how", "/terms", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...STATIC.map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "daily" as const, priority: path === "/" ? 1 : 0.7 })),
    ...ROSTER.slice(0, 60).map((s) => ({ url: `${SITE_URL}/s/${s.ticker}`, changeFrequency: "daily" as const, priority: 0.5 })),
  ];
}
