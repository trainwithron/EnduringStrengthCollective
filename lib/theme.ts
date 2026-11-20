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
// Look Refresh (Ron, Nov 20: the coach app "feels kind of plain and blocky and lifeless"): a deeper ground, so the cards (one step lighter, see surfaceTokensFor) read as raised.
export const DEFAULT_BACKGROUND_COLOR = "#0F0E0D";
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
  // Was "sharp" — a live DOM audit of production found zero elements
  // anywhere with any border-radius/box-shadow, since this one setting
  // zeroes out the entire radius scale platform-wide (radiusScaleFor
  // above). "Rounded" was already a fully-built, Settings-exposed
  // option; it just wasn't the default. Flipped 2026-09-14 per Ron's own
  // direct word, following a design audit's "soulless"/"Soviet" finding.
  buttonShape: "rounded",
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

// Look Refresh (Ron, Nov 20): the card colors come from the organization's own ground instead of one fixed #262422, so cards always sit one warm step above it.
// surface = cards and panels, surface2 = raised items inside them, line = a quiet divider. With the default ground #0F0E0D: #1A1816, #23201D, #2E2A26.
// A light ground (none today) steps darker instead. steel (secondary text) is the organization's own text color dimmed a quarter toward the ground, then
// raised back toward it until it reads at 4.5:1 on surface2, so it always passes on cards and on raised items.
export interface SurfaceTokens {
  surface: string;
  surface2: string;
  line: string;
  steel: string;
}

const SURFACE_STEP: [number, number, number] = [11, 10, 9];
const SURFACE_2_STEP: [number, number, number] = [20, 18, 16];
const LINE_STEP: [number, number, number] = [31, 28, 25];

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function luminanceOf([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratioOf(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function surfaceTokensFor(backgroundColor: string, textColor: string): SurfaceTokens {
  const ground = parseHex(backgroundColor) ?? (parseHex(DEFAULT_BACKGROUND_COLOR) as [number, number, number]);
  const text = parseHex(textColor) ?? (parseHex(DEFAULT_TEXT_COLOR) as [number, number, number]);
  const dir = luminanceOf(ground) > 0.4 ? -1 : 1;
  const step = (s: [number, number, number]): [number, number, number] => [ground[0] + dir * s[0], ground[1] + dir * s[1], ground[2] + dir * s[2]];
  const surface2 = step(SURFACE_2_STEP).map((c) => Math.max(0, Math.min(255, Math.round(c)))) as [number, number, number];
  let t = 0.25;
  let steel = mix(text, ground, t).map(Math.round) as [number, number, number];
  while (t > 0 && ratioOf(steel, surface2) < 4.5) {
    t = Math.max(0, t - 0.01);
    steel = mix(text, ground, t).map(Math.round) as [number, number, number];
  }
  return { surface: toHex(step(SURFACE_STEP)), surface2: toHex(surface2), line: toHex(step(LINE_STEP)), steel: toHex(steel) };
}

// Card and row corners (Look Refresh): cards and panels rounded, rows inside them a little less; an organization that chose Sharp keeps every corner square.
export function cardRadiiFor(shape: ButtonShape): { card: string; row: string } {
  return shape === "sharp" ? { card: "0px", row: "0px" } : { card: "16px", row: "10px" };
}

// The single place that turns an OrgTheme into the CSS custom properties
// globals.css/tailwind.config.ts read (--rust/--graphite/--chalk/
// --font-display/--font-body/--btn-radius) — applied at the app root so
// every surface (coach desktop AND the athlete mobile app) shares one
// identity, instead of each shell re-deriving this mapping itself.
export function orgThemeToCssVars(theme: OrgTheme): CSSProperties {
  const scale = radiusScaleFor(theme.buttonShape);
  const tokens = surfaceTokensFor(theme.backgroundColor, theme.textColor);
  const radii = cardRadiiFor(theme.buttonShape);
  return {
    "--rust": hexToRgbTriplet(theme.accentColor),
    "--graphite": hexToRgbTriplet(theme.backgroundColor),
    "--chalk": hexToRgbTriplet(theme.textColor),
    "--surface": hexToRgbTriplet(tokens.surface),
    "--surface-2": hexToRgbTriplet(tokens.surface2),
    "--line": hexToRgbTriplet(tokens.line),
    "--steel": hexToRgbTriplet(tokens.steel),
    "--r-card": radii.card,
    "--r-row": radii.row,
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
