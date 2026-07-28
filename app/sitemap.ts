import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://kirans.me/csv-viewer/",
      lastModified: new Date("2026-07-28"),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
