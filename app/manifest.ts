import type { MetadataRoute } from "next";

// Served automatically by Next.js at /manifest.webmanifest — this is what
// makes "Add to Home Screen" produce a real app-like icon/name/standalone
// window on Android instead of a bare browser bookmark. iOS Safari ignores
// most of this (it needs the apple-specific meta tags in layout.tsx
// instead), but picks up name/icon well enough via the same file.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Enduring Strength Collective",
    short_name: "ESC",
    description: "Group training platform for The Enduring Strength Collective.",
    start_url: "/",
    display: "standalone",
    background_color: "#1C1B1A",
    theme_color: "#1C1B1A",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
