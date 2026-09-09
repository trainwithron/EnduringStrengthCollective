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

export const DEFAULT_ACCENT_COLOR = "#C4622D";
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

// The single place that turns an OrgTheme into the CSS custom properties
// globals.css/tailwind.config.ts read (--rust/--graphite/--chalk/
// --font-display/--font-body/--btn-radius) — applied at the app root so
// every surface (coach desktop AND the athlete mobile app) shares one
// identity, instead of each shell re-deriving this mapping itself.
export function orgThemeToCssVars(theme: OrgTheme): CSSProperties {
  return {
    "--rust": theme.accentColor,
    "--graphite": theme.backgroundColor,
    "--chalk": theme.textColor,
    "--font-display": `"${theme.fontDisplay}"`,
    "--font-body": `"${theme.fontBody}"`,
    "--btn-radius": BUTTON_SHAPE_RADIUS[theme.buttonShape],
  } as CSSProperties;
}
