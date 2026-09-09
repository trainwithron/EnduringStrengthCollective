import type { MetadataRoute } from "next";
import { getViewerOrgTheme } from "@/lib/org-theme-server";

// Served automatically by Next.js at /manifest.webmanifest — this is what
// makes "Add to Home Screen" produce a real app-like icon/name/standalone
// window on Android instead of a bare browser bookmark. iOS Safari ignores
// most of this (it needs the apple-specific meta tags in layout.tsx
// instead), but picks up name/icon well enough via the same file.
//
// Personalized per the signed-in viewer's organization so a white-labeled
// org's coaches/clients get their own name/color/icon on the home screen,
// not the shared "ESC" default — this route runs server-side per request,
// same as any other page, so reading the session here is safe.
// A short home-screen label — initials of the org name (e.g. "Enduring
// Strength Co." -> "ESC") when the full name would be too long to read
// under a home-screen icon, otherwise the name itself.
function shortNameFor(name: string): string {
  if (name.length <= 12) return name;
  const initials = name
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w[0]))
    .map((w) => w[0].toUpperCase())
    .join("");
  return initials.length >= 2 ? initials : name.slice(0, 12);
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const theme = await getViewerOrgTheme();
  const name = theme.orgName ?? "The Enduring Strength Collective";

  // An org's uploaded app icon is used at both declared sizes rather than
  // generating real 192/512 renditions server-side — acceptable for now
  // since most modern browsers scale a single square source fine; revisit
  // if a specific org's icon looks soft on a real device.
  const icons = theme.appIconUrl
    ? [
        { src: theme.appIconUrl, sizes: "192x192", type: "image/png", purpose: "any" as const },
        { src: theme.appIconUrl, sizes: "512x512", type: "image/png", purpose: "any" as const },
      ]
    : [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" as const },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" as const },
      ];

  return {
    name,
    short_name: shortNameFor(name),
    description: `Group training platform for ${name}.`,
    start_url: "/",
    display: "standalone",
    background_color: theme.backgroundColor,
    theme_color: theme.backgroundColor,
    icons,
  };
}
