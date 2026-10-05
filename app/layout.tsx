import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AddToHomeScreenPrompt } from "@/components/add-to-home-screen-prompt";
import { PwaContextCookie } from "@/components/pwa-context-cookie";
import { LoadingWatchdog } from "@/components/ui/loading-watchdog";
import { getViewerOrgTheme } from "@/lib/org-theme-server";
import { orgThemeToCssVars } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Spotlight Coaching",
  description: "Spotlight Coaching — group training platform",
  manifest: "/manifest.webmanifest",
  // iOS Safari doesn't read the web manifest for "standalone" behavior —
  // it needs these apple-specific tags instead. Without appleWebApp.capable,
  // "Add to Home Screen" just bookmarks the page with browser chrome still
  // showing, instead of opening full-screen like a real app.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Spotlight",
  },
};

export const viewport: Viewport = {
  themeColor: "#1C1B1A",
};

// Organization branding (colors, fonts, button shape, logo/icon) is
// resolved once here and applied as CSS custom properties on <html> —
// every surface in the app (coach desktop shell AND the athlete mobile
// app) reads the same --rust/--graphite/--chalk/--font-* variables via
// tailwind.config.ts, so theming the whole app is just setting them at
// the root instead of duplicating this per shell.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getViewerOrgTheme();
  const cssVars = orgThemeToCssVars(theme);

  return (
    <html lang="en" style={cssVars}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- one shared stylesheet holding every selectable brand font, so a coach's font choice previews instantly. */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&family=Oswald:wght@500;700&family=Bebas+Neue&family=Anton&family=Roboto:wght@400;500;600&family=Work+Sans:wght@400;500;600&family=Nunito+Sans:wght@400;600;700&display=swap" />
        {theme.appIconUrl && <link rel="apple-touch-icon" href={theme.appIconUrl} />}
        {theme.appIconUrl && <link rel="icon" href={theme.appIconUrl} />}
      </head>
      <body className="font-body bg-graphite text-chalk min-h-screen">
        <PwaContextCookie />
        <AddToHomeScreenPrompt />
        <LoadingWatchdog />
        {children}
      </body>
    </html>
  );
}
