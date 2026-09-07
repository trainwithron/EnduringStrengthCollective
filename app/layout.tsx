import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AddToHomeScreenPrompt } from "@/components/add-to-home-screen-prompt";

export const metadata: Metadata = {
  title: "The Enduring Strength Collective",
  description: "The Enduring Strength Collective — group training platform",
  manifest: "/manifest.webmanifest",
  // iOS Safari doesn't read the web manifest for "standalone" behavior —
  // it needs these apple-specific tags instead. Without appleWebApp.capable,
  // "Add to Home Screen" just bookmarks the page with browser chrome still
  // showing, instead of opening full-screen like a real app.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ESC",
  },
};

export const viewport: Viewport = {
  themeColor: "#1C1B1A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-body bg-graphite text-chalk min-h-screen">
        <AddToHomeScreenPrompt />
        {children}
      </body>
    </html>
  );
}
