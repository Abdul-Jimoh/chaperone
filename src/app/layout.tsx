import type { Metadata, Viewport } from "next";
import { Architects_Daughter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const hand = Architects_Daughter({ subsets: ["latin"], weight: "400", variable: "--font-architects", display: "swap" });

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Chaperone: your agent shops, Chaperone holds the money", template: "%s · Chaperone" },
  description:
    "Write your shopping rules in plain English. Every purchase your AI agent makes becomes a PayPal authorization hold that deterministic code checks before it is captured or voided.",
  applicationName: "Chaperone",
  openGraph: { type: "website", siteName: "Chaperone" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ECE9E3" },
    { media: "(prefers-color-scheme: dark)", color: "#0D0D0C" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
