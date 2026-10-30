// Root layout: the HTML shell around every page.
// Runs on the SERVER (it is a Server Component). Its only client part is the
// service-worker registration (Stage 9), which renders nothing.
// We use the system font stack (see globals.css) so no fonts are downloaded
// from third parties — this keeps the app fast and private.

import type { Metadata, Viewport } from "next";
import "./globals.css";
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
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <LanguageProvider>
            {children}
          </LanguageProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
