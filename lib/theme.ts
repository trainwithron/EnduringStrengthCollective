// Coach desktop branding: a button "shape" preset maps to a CSS
// border-radius value applied only within the coach shell (see
// coach-desktop-shell.tsx and globals.css's .coach-branded-shell rule).
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
