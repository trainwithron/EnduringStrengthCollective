import { BODY_FONT_OPTIONS, DEFAULT_FONT_BODY, DEFAULT_FONT_DISPLAY, DISPLAY_FONT_OPTIONS } from "@/lib/theme";

// The weights loaded for each selectable brand font (exactly what the app has always loaded).
const WEIGHTS: Record<string, string> = {
  "Barlow Condensed": "wght@600;700",
  Inter: "wght@400;500;600",
  Oswald: "wght@500;700",
  "Bebas Neue": "",
  Anton: "",
  Roboto: "wght@400;500;600",
  "Work Sans": "wght@400;500;600",
  "Nunito Sans": "wght@400;600;700",
};

// One Google Fonts stylesheet for the given families. The page that every visitor loads asks only for the fonts it shows (the platform pair plus the organization's own
// choice); the branding page, where a coach compares fonts, asks for all of them.
export function googleFontsHref(families: readonly string[]): string {
  const unique = Array.from(new Set(families)).filter((f) => f in WEIGHTS);
  const parts = unique.map((f) => {
    const weights = WEIGHTS[f];
    return `family=${f.replace(/ /g, "+")}${weights ? `:${weights}` : ""}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap`;
}

export const ALL_BRAND_FONTS: readonly string[] = [...DISPLAY_FONT_OPTIONS, ...BODY_FONT_OPTIONS];

// What every page needs: the platform's own two fonts (the share pictures and the fallback look rely on them) and whatever the viewer's organization chose.
export function baseFontFamilies(theme: { fontDisplay: string; fontBody: string }): string[] {
  return [DEFAULT_FONT_DISPLAY, DEFAULT_FONT_BODY, theme.fontDisplay, theme.fontBody];
}
