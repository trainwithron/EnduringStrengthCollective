import type { CSSProperties } from "react";

// Organization branding: a button "shape" preset maps to a CSS
// border-radius value applied app-wide (see app/layout.tsx and
// globals.css's .bg-rust.text-graphite rule).
export type ButtonShape = "sharp" | "rounded" | "pill";

export const BUTTON_SHAPE_RADIUS: Record<ButtonShape, string> = {
  sharp: "0px",
  rounded: "10px",
  pill: "9999px",
};

export const BUTTON_SHAPE_LABELS: Record<ButtonShape, string> = {
  sharp: "Sharp",
  rounded: "Rounded",
  pill: "Pill",
};

// Widens the existing Button Shape setting from "one flat radius on
// filled CTA buttons" into a real scale other surfaces (cards, inputs,
// badges, the logging screen's set cells) can opt into. "Sharp" stays
// every-corner-square everywhere, including sm/md/lg/pill/circle — a set-
// number badge or a checkmark is a genuinely square token under Sharp,
// same as a button. "Rounded" and "Pill" both soften the whole UI, not
// just buttons — but at different intensities, so choosing between them
// still means something beyond the CTA buttons: "Pill" reads noticeably
// softer than "Rounded"'s more modest curve, at every role. Cards get a
// gentler curve than pills/circles even under the same setting — a card
// is a container holding a lot of content, not a discrete token, so the
// same "soft" choice reads as intentional there without making the
// layout feel like it's made of bubbles.
export interface RadiusScale {
  sm: string;
  md: string;
  lg: string;
  pill: string;
  circle: string;
}

const RADIUS_SCALE_BY_SHAPE: Record<ButtonShape, RadiusScale> = {
  sharp: { sm: "0px", md: "0px", lg: "0px", pill: "0px", circle: "0px" },
  rounded: { sm: "6px", md: "10px", lg: "16px", pill: "9999px", circle: "9999px" },
  pill: { sm: "8px", md: "14px", lg: "22px", pill: "9999px", circle: "9999px" },
};

export function radiusScaleFor(shape: ButtonShape): RadiusScale {
  return RADIUS_SCALE_BY_SHAPE[shape];
}

// Nudged from #C4622D — the original failed WCAG AA contrast (4.5:1)
// both as button text-on-background and as accent text on the app's
// dark surfaces; this clears 4.5:1 in both directions. Only affects the
// platform default — a coach who's customized their own accent color
// isn't automatically contrast-checked.
export const DEFAULT_ACCENT_COLOR = "#D2703B";
export const DEFAULT_BACKGROUND_COLOR = "#1C1B1A";
export const DEFAULT_TEXT_COLOR = "#EDE8E0";

// A short, curated list rather than every Google Font — each one is
// already loaded by globals.css so switching is instant, no reload
// needed to fetch a new font file.
export const DISPLAY_FONT_OPTIONS = ["Barlow Condensed", "Oswald", "Bebas Neue", "Anton"] as const;
export type DisplayFont = (typeof DISPLAY_FONT_OPTIONS)[number];
export const DEFAULT_FONT_DISPLAY: DisplayFont = "Barlow Condensed";

export const BODY_FONT_OPTIONS = ["Inter", "Roboto", "Work Sans", "Nunito Sans"] as const;
export type BodyFont = (typeof BODY_FONT_OPTIONS)[number];
export const DEFAULT_FONT_BODY: BodyFont = "Inter";

export interface OrgTheme {
  buttonShape: ButtonShape;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontDisplay: DisplayFont;
  fontBody: BodyFont;
  logoUrl: string | null;
  appIconUrl: string | null;
  orgName: string | null;
}

export const DEFAULT_ORG_THEME: OrgTheme = {
  buttonShape: "sharp",
  accentColor: DEFAULT_ACCENT_COLOR,
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  textColor: DEFAULT_TEXT_COLOR,
  fontDisplay: DEFAULT_FONT_DISPLAY,
  fontBody: DEFAULT_FONT_BODY,
  logoUrl: null,
  appIconUrl: null,
  orgName: null,
};

// tailwind.config.ts's graphite/rust/chalk colors read these CSS vars
// through Tailwind's `rgb(var(--x) / <alpha-value>)` pattern — the only
// way a CSS-variable-backed theme color can still support opacity
// modifiers like bg-rust/50 (a bare hex string in a var() can't be
// combined with Tailwind's alpha-value substitution at all; every
// bg-graphite/NN-style utility across the app silently generated no
// CSS whatsoever until this was in "R G B" form). So the vars themselves
// store space-separated R G B channels, not a hex string — this
// converts whatever hex a coach picked (or a default) into that form.
function hexToRgbTriplet(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "0 0 0";
  const n = parseInt(match[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// The single place that turns an OrgTheme into the CSS custom properties
// globals.css/tailwind.config.ts read (--rust/--graphite/--chalk/
// --font-display/--font-body/--btn-radius) — applied at the app root so
// every surface (coach desktop AND the athlete mobile app) shares one
// identity, instead of each shell re-deriving this mapping itself.
export function orgThemeToCssVars(theme: OrgTheme): CSSProperties {
  const scale = radiusScaleFor(theme.buttonShape);
  return {
    "--rust": hexToRgbTriplet(theme.accentColor),
    "--graphite": hexToRgbTriplet(theme.backgroundColor),
    "--chalk": hexToRgbTriplet(theme.textColor),
    "--font-display": `"${theme.fontDisplay}"`,
    "--font-body": `"${theme.fontBody}"`,
    "--btn-radius": BUTTON_SHAPE_RADIUS[theme.buttonShape],
    "--r-sm": scale.sm,
    "--r-md": scale.md,
    "--r-lg": scale.lg,
    "--r-pill": scale.pill,
    "--r-circle": scale.circle,
  } as CSSProperties;
}
