// WCAG contrast foolproofing (wcag_contrast_foolproofing_idea.md) — real
// WCAG 2.x relative-luminance + contrast-ratio math, no library needed.
// Live warn-not-block on the three color pairs org branding actually
// renders as text/component-on-background: text-on-background (body
// content), accent-on-background (buttons/links as a visible shape),
// and text-on-accent (a body-text-colored label on an accent-filled
// surface). AA thresholds only — 4.5:1 for normal text, 3:1 for the
// large/bold-text and component-visibility cases.

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
export function relativeLuminance({ r, g, b }: RgbColor): number {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio — (L1 + 0.05) / (L2 + 0.05),
// lighter over darker. Null for malformed input rather than throwing —
// callers see this while a coach is mid-edit in a color-text field.
export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const lA = relativeLuminance(a);
  const lB = relativeLuminance(b);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const AA_NORMAL_TEXT_RATIO = 4.5;
export const AA_LARGE_OR_COMPONENT_RATIO = 3;

export function passesAA(ratio: number | null, kind: "normal" | "large"): boolean {
  if (ratio === null) return true;
  return ratio >= (kind === "normal" ? AA_NORMAL_TEXT_RATIO : AA_LARGE_OR_COMPONENT_RATIO);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Suggests the closest color to `adjustable` — by lightness only, hue and
// saturation stay exactly what the coach picked, so the suggestion still
// reads as "their" color, not a random passing one — that clears
// `minRatio` against `fixed`. Tries both lighter and darker and returns
// whichever needs the smaller lightness change.
export function nearestPassingColor(adjustable: string, fixed: string, minRatio: number): string | null {
  const hsl = hexToHsl(adjustable);
  if (!hsl || !hexToRgb(fixed)) return null;

  function passesAtLightness(l: number): boolean {
    const candidate = hslToHex(hsl!.h, hsl!.s, l);
    const ratio = contrastRatio(candidate, fixed);
    return ratio !== null && ratio >= minRatio;
  }

  function search(towardWhite: boolean): number | null {
    let lo = hsl!.l;
    let hi = towardWhite ? 1 : 0;
    if (!passesAtLightness(hi)) return null;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (passesAtLightness(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  const lighter = search(true);
  const darker = search(false);
  const candidates = [lighter, darker].filter((v): v is number => v !== null);
  // Black or white against any real color always clears AA — one
  // direction should always succeed. This is a defensive fallback only.
  if (candidates.length === 0) return passesAtLightness(0) ? "#000000" : "#ffffff";

  const best = candidates.reduce((a, b) => (Math.abs(a - hsl.l) < Math.abs(b - hsl.l) ? a : b));
  return hslToHex(hsl.h, hsl.s, best);
}
