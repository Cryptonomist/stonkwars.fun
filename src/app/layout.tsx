import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Big_Shoulders_Stencil, Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/Providers";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { BRAND, SITE_URL } from "@/lib/brand";
import "./globals.css";

/* next/font self-hosts these at build time: no request to Google from a
 * visitor's browser, and the metrics are inlined so nothing shifts. */
/* adjustFontFallback is off for both Big Shoulders faces because next/font has
 * no metrics for them since Google renamed the family; the fallback in
 * globals.css (Arial Narrow, Impact) is condensed enough that the swap barely
 * moves anything. */
const display = Big_Shoulders({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-display-face",
  display: "swap",
  adjustFontFallback: false,
});
/* The COOKED stamp, and nothing else: a stencil, like a crate marking. */
const stencil = Big_Shoulders_Stencil({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-stencil-face",
  display: "swap",
  adjustFontFallback: false,
});
const body = Geist({ subsets: ["latin"], variable: "--font-body-face", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name} · ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.pitch,
  applicationName: BRAND.name,
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: BRAND.name,
    title: `${BRAND.name} · ${BRAND.tagline}`,
    description: BRAND.pitch,
  },
  twitter: { card: "summary_large_image", site: BRAND.x, title: BRAND.name, description: BRAND.tagline },
};

export const viewport: Viewport = {
  themeColor: "#07070b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${stencil.variable} ${body.variable} ${mono.variable}`}>
      <body className="arena min-h-dvh antialiased">
        <Providers>
          <SiteNav />
          <main className="mx-auto max-w-6xl px-4">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
