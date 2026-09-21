import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/brand";

/* Pages are for everyone; the API is not a page. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
