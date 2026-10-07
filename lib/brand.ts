// The ONE place the default brand mark is named. Everything that shows the Spotlight mark (the favicon, the home-screen icons, the share card, the push badge, the social
// image) reads it from here, so a future redraw by a local artist is a one-place swap: replace the files in public/brand/ (and run `npm run brand:icons` to rebuild the
// PNG sizes), change nothing else.
//
// The rule for a coach's or gym's own branding: a custom logo or app icon that the organisation has uploaded ALWAYS wins; the Spotlight default is only the fallback
// (see brandMarkSrc and brandAppIconSrc, and lib/brand.test.ts).

export const BRAND = {
  name: "Spotlight Coaching",
  wordmark: "SPOTLIGHT",
  wordmarkSub: "COACHING",
  // The mark is a halo at the top with a cone of light falling onto a barbell. "OnDark" is the one drawn for dark backgrounds, "OnLight" for light ones.
  assets: {
    markOnDark: "/brand/spotlight-mark-dark.svg",
    markOnLight: "/brand/spotlight-mark-light.svg",
    appIcon: "/brand/spotlight-app-icon.svg",
    favicon: "/brand/spotlight-favicon.svg",
    // Monochrome (white on transparent) for the small status-bar icon of a push notification.
    pushBadge: "/brand/spotlight-badge-72.png",
    // 1200 x 630, for links shared on social media.
    socialImage: "/brand/spotlight-og.png",
  },
  // The home-screen icons the web app manifest lists when the organisation has no icon of its own (built from appIcon by `npm run brand:icons`).
  homeScreenIcons: {
    any192: "/icon-192.png",
    any512: "/icon-512.png",
    maskable192: "/icon-maskable-192.png",
    maskable512: "/icon-maskable-512.png",
  },
  // The colours of the mark, for the places that draw it themselves (the share-card image). They match the SVG files; lib/brand.test.ts checks they still do.
  palette: {
    onDark: { cone: "#F4C95D", coneAlphaTop: 0.78, coneAlphaBottom: 0.08, halo: "#FFF4D6", bar: "#FFF4D6", plateOuter: "#F4C95D", plateInner: "#E29A2C" },
    onLight: { cone: "#E29A2C", coneAlphaTop: 0.8, coneAlphaBottom: 0.1, halo: "#1B1A17", bar: "#1B1A17", plateOuter: "#B87612", plateInner: "#8A560A" },
  },
} as const;

export type BrandBackground = "dark" | "light";

const clean = (url: string | null | undefined): string | null => {
  const u = typeof url === "string" ? url.trim() : "";
  return u.length > 0 ? u : null;
};

// The logo to show: the organisation's own when it has uploaded one, otherwise the Spotlight mark that suits the background.
export function brandMarkSrc(customLogoUrl: string | null | undefined, background: BrandBackground = "dark"): string {
  return clean(customLogoUrl) ?? (background === "light" ? BRAND.assets.markOnLight : BRAND.assets.markOnDark);
}

// The app icon to show (browser tab, home screen): the organisation's own when it has uploaded one, otherwise the Spotlight app icon.
export function brandAppIconSrc(customAppIconUrl: string | null | undefined): string {
  return clean(customAppIconUrl) ?? BRAND.homeScreenIcons.any512;
}
