import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/brand";

/* Pages are for everyone; the API and the brand workbench are not pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/brand/lab/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
