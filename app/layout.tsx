import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSV Viewer — Explore CSV files in your browser",
  description:
    "A fast, private CSV viewer for searching, sorting and exporting tabular data. Your files never leave your browser.",
  metadataBase: new URL("https://kirans.me/csv-viewer/"),
  openGraph: {
    title: "CSV Viewer",
    description: "See what’s inside your CSV—fast, private and in your browser.",
    type: "website",
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
    title: "CSV Viewer",
    description: "See what’s inside your CSV—fast, private and in your browser.",
    images: ["https://kirans.me/csv-viewer/og.png"],
  },
  icons: {
    icon: "favicon.svg",
    shortcut: "favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
