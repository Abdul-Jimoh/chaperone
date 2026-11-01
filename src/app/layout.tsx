import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chaperone",
  description: "Your agent shops. Chaperone holds the money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
