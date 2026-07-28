import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://kirans.me/csv-viewer/sitemap.xml",
    host: "https://kirans.me",
  };
}
