/* A PAGE'S OWN TITLE AND DESCRIPTION, EVERYWHERE A LINK TO IT IS SHOWN.
 *
 * Next REPLACES a parent's `openGraph` and `twitter` objects rather than
 * merging into them. The layout sets both for the home page, and the static
 * pages set only `title` and `description`, so a link to /pre-ipo or
 * /exhibition posted on X unfurled with the home page's title, the home page's
 * description and the home page's URL. Three pages had no description at all
 * and inherited the home page's there too.
 *
 * One helper, so every static page says the same thing in all four places. The
 * image is left alone: with none set, Next uses the nearest opengraph-image,
 * which is the site's card. */

import type { Metadata } from "next";

import { BRAND } from "./brand";

export function pageMeta(title: string, description: string, path: string): Metadata {
  const full = `${title} · ${BRAND.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: BRAND.name, url: path, title: full, description },
    twitter: { card: "summary_large_image", site: BRAND.x, title: full, description },
  };
}
