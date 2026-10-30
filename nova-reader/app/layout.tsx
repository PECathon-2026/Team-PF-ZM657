// Root layout: the HTML shell around every page.
// Runs on the SERVER (it is a Server Component).
// Includes ThemeProvider, FontSizeProvider, LanguageProvider, and the local
// high-resolution editorial reading backdrop (/images/editorial-reading-backdrop.jpg).

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FontSizeProvider } from "@/components/FontSizeProvider";
import { LanguageProvider } from "@/components/LanguagePreferences";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "NOVA Reader",
  description: "A privacy-first, offline-first reader for RSS and Atom feeds.",
  openGraph: {
    title: "NOVA Reader",
    description: "A privacy-first, offline-first reader for RSS and Atom feeds.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1311" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="relative min-h-dvh antialiased">
        {/* Ambient high-resolution editorial library backdrop with fallback gradient & contrast veil */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-surface-muted via-bg to-accent-soft/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/editorial-reading-backdrop.jpg"
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center opacity-35 dark:opacity-22"
          />
          <div className="absolute inset-0 bg-bg/78 backdrop-blur-[1.5px] dark:bg-bg/84" />
        </div>

        <ThemeProvider>
          <FontSizeProvider>
            <LanguageProvider>{children}</LanguageProvider>
          </FontSizeProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
