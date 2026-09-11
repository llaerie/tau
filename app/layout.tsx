import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tau AI CFO", template: "%s · Tau AI CFO" },
  description: "Tau AI CFO — Phase One Training Lab executive finance console",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f4f0" }, { media: "(prefers-color-scheme: dark)", color: "#121211" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
