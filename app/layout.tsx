import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";
import { themeInitScript } from "@/src/lib/theme";

const sans = localFont({
  src: "../public/qsl-font.ttf",
  variable: "--font-sans",
});

const display = localFont({
  src: "../public/qsl-font.ttf",
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
  category: "technology",
  appleWebApp: {
    capable: true,
    title: "OK2KZB Solární dohled",
    statusBarStyle: "black-translucent",
  },
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
