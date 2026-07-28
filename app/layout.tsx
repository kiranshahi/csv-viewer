import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Free Online CSV Viewer — Search, Sort & Explore CSV Files",
  description:
    "Open and explore CSV files online for free. Search, sort, hide columns, view every row and export filtered data privately in your browser.",
  metadataBase: new URL("https://kirans.me/csv-viewer/"),
  applicationName: "CSV Viewer",
  authors: [{ name: "Kiran Shahi", url: "https://kirans.me/" }],
  creator: "Kiran Shahi",
  publisher: "Kiran Shahi",
  alternates: {
    canonical: "https://kirans.me/csv-viewer/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "Free Online CSV Viewer",
    description:
      "Search, sort and explore CSV files privately in your browser. No uploads, accounts or installation.",
    type: "website",
    url: "https://kirans.me/csv-viewer/",
    siteName: "CSV Viewer",
    locale: "en_GB",
    images: [
      {
        url: "https://kirans.me/csv-viewer/og.png",
        width: 1734,
        height: 900,
        alt: "CSV Viewer — See what’s inside your CSV.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Online CSV Viewer",
    description:
      "Search, sort and explore CSV files privately in your browser.",
    images: ["https://kirans.me/csv-viewer/og.png"],
  },
  icons: {
    icon: "favicon.svg",
    shortcut: "favicon.svg",
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "CSV Viewer",
  url: "https://kirans.me/csv-viewer/",
  description:
    "A free online CSV viewer for searching, sorting, hiding columns and exporting filtered CSV data privately in the browser.",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires a modern web browser with JavaScript enabled.",
  featureList: [
    "Open CSV files locally",
    "Search across every column",
    "Sort rows by any column",
    "Hide and restore columns",
    "View all rows",
    "Export filtered CSV data",
  ],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "GBP",
  },
  author: {
    "@type": "Person",
    name: "Kiran Shahi",
    url: "https://kirans.me/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
          }}
        />
      </body>
    </html>
  );
}
