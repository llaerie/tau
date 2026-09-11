import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Finance Desk", template: "%s · Finance Desk" },
  description: "Ask about the company, the household or your own money. Every figure is computed, labelled and explainable.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f6f2" }, { media: "(prefers-color-scheme: dark)", color: "#15171a" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = jar.get("fd_theme")?.value;
  const dataTheme = theme === "light" || theme === "dark" ? theme : undefined;
  return (
    <html lang="en" className={inter.variable} data-theme={dataTheme} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
