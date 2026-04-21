import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";

import "./globals.css";
import { themeInitScript } from "@/src/lib/theme";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "OK2MKJ",
    template: "%s | OK2MKJ",
  },
  description: "Radioamatérský web OK2MKJ se zápisky z provozu, mapou spojení a databází QSO.",
  applicationName: "OK2MKJ",
  keywords: ["OK2MKJ", "radioamatér", "QSO", "ham radio", "logbook", "mapa spojení", "antény", "provoz"],
  authors: [{ name: "Jakub / OK2MKJ" }],
  openGraph: {
    title: "OK2MKJ",
    description: "Zápisky z provozu, mapa spojení a živý deník radioamatérské stanice.",
    type: "website",
    locale: "cs_CZ",
    siteName: "OK2MKJ",
    images: [{ url: "/og-image.svg", width: 1200, height: 630, alt: "OK2MKJ" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "OK2MKJ",
    description: "Zápisky z provozu, mapa spojení a živý deník radioamatérské stanice.",
    images: ["/og-image.svg"],
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" data-theme="light" suppressHydrationWarning>
      <body className={`${sans.variable} ${display.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
