// A coach's one short public page (/c/<their booking address>). What the coach types is cleaned here before it is saved and again before it is shown; the page shows only what is
// below plus the coach's public packages and featured shop cards, never anything about a client.

export const SITE_LIMITS = { headline: 120, whoIHelp: 300, whatIDo: 600, whyLines: 6, whyLineLength: 100, reviews: 3, quote: 240, firstName: 30, eyebrow: 60, facts: 3, factTitle: 30, factLine: 60, packagesNote: 300, tagline: 120, consultNote: 200 } as const;

export type SiteBackground = "dark" | "light" | "brand";
export const SITE_BACKGROUNDS: { value: SiteBackground; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "brand", label: "Brand color" },
];

export interface SiteReview {
  quote: string;
  first_name: string;
}

// A short fact under the page header (Oct 28 redesign), e.g. {title: "Free consult", line: "Up to 50 min in person"}.
export interface SiteFact {
  title: string;
  line: string;
}

export interface SiteContent {
  headline: string;
  whoIHelp: string;
  whatIDo: string;
  whyLines: string[];
  reviews: SiteReview[];
  background: SiteBackground;
  eyebrow: string;
  facts: SiteFact[];
  packagesNote: string;
  tagline: string;
  consultNote: string;
}

const clamp = (text: unknown, max: number) => (typeof text === "string" ? text.trim().slice(0, max) : "");

// Trims, drops empty lines and reviews, and cuts everything to its limit.
export interface SiteInput {
  headline?: string;
  whoIHelp?: string;
  whatIDo?: string;
  whyLines?: string[];
  reviews?: Partial<SiteReview>[];
  background?: string;
  eyebrow?: string;
  facts?: Partial<SiteFact>[];
  packagesNote?: string;
  tagline?: string;
  consultNote?: string;
}

export function cleanSite(input: SiteInput): SiteContent {
  const whyLines = (Array.isArray(input.whyLines) ? input.whyLines : [])
    .map((l) => clamp(l, SITE_LIMITS.whyLineLength))
    .filter((l) => l !== "")
    .slice(0, SITE_LIMITS.whyLines);
  const reviews = (Array.isArray(input.reviews) ? input.reviews : [])
    .map((r) => ({ quote: clamp(r?.quote, SITE_LIMITS.quote), first_name: clamp(r?.first_name, SITE_LIMITS.firstName).split(/\s+/)[0] ?? "" }))
    .filter((r) => r.quote !== "")
    .slice(0, SITE_LIMITS.reviews);
  const facts = (Array.isArray(input.facts) ? input.facts : [])
    .map((f) => ({ title: clamp(f?.title, SITE_LIMITS.factTitle), line: clamp(f?.line, SITE_LIMITS.factLine) }))
    .filter((f) => f.title !== "")
    .slice(0, SITE_LIMITS.facts);
  const background: SiteBackground = input.background === "light" || input.background === "brand" ? input.background : "dark";
  return {
    headline: clamp(input.headline, SITE_LIMITS.headline),
    whoIHelp: clamp(input.whoIHelp, SITE_LIMITS.whoIHelp),
    whatIDo: clamp(input.whatIDo, SITE_LIMITS.whatIDo),
    whyLines,
    reviews,
    background,
    eyebrow: clamp(input.eyebrow, SITE_LIMITS.eyebrow),
    facts,
    packagesNote: clamp(input.packagesNote, SITE_LIMITS.packagesNote),
    tagline: clamp(input.tagline, SITE_LIMITS.tagline),
    consultNote: clamp(input.consultNote, SITE_LIMITS.consultNote),
  };
}

// Reads the jsonb reviews column back safely (anything that is not {quote, first_name} is dropped).
// Reads the jsonb facts column back safely.
export function factsFromJson(value: unknown): SiteFact[] {
  if (!Array.isArray(value)) return [];
  return cleanSite({ facts: value as Partial<SiteFact>[] }).facts;
}

export function reviewsFromJson(value: unknown): SiteReview[] {
  if (!Array.isArray(value)) return [];
  return cleanSite({ reviews: value as Partial<SiteReview>[] }).reviews;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// Readable text on a colour: dark text on a light colour, light on a dark one.
export function contrastText(hex: string): string {
  return luminance(hex) > 0.4 ? "#1C1B1A" : "#F5F2EC";
}

export interface SiteColors {
  bg: string;
  text: string;
  accent: string;
  muted: string;
  card: string;
}

// The page's colours from the organization's own branding: Dark and Light are the brand's dark ground or a plain light one, Brand color uses the accent as the ground.
export function siteColors(background: SiteBackground, brand: { backgroundColor: string; textColor: string; accentColor: string }): SiteColors {
  if (background === "light") return { bg: "#F7F6F3", text: "#1C1B1A", accent: brand.accentColor, muted: "#5F5B52", card: "#FFFFFF" };
  if (background === "brand") {
    const text = contrastText(brand.accentColor);
    return { bg: brand.accentColor, text, accent: text, muted: text, card: "rgba(255,255,255,0.12)" };
  }
  return { bg: brand.backgroundColor, text: brand.textColor, accent: brand.accentColor, muted: brand.textColor + "B3", card: "rgba(255,255,255,0.06)" };
}

// A link is only shown if it is an ordinary web address.
export function safeWebUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// An uploaded picture's path must sit in the coach's own folder (what the upload rules allow); anything else is not shown.
export function ownImagePath(path: string | null | undefined, coachId: string): string | null {
  if (!path) return null;
  return path.startsWith(`${coachId}/`) && !path.includes("..") ? path : null;
}

export function hasSiteContent(c: SiteContent): boolean {
  return !!(c.headline || c.whoIHelp || c.whatIDo || c.whyLines.length || c.reviews.length || c.eyebrow || c.facts.length || c.tagline);
}

// Which organization's branding the page wears when the coach is in several: one they OWN before one they only help run, then the oldest. Stable, so the page never changes colours
// between visits. (A coach who owns several gets the oldest; choosing a different one would need a setting on the site.)
export function pickBrandOrg<T extends { id: string; created_at: string | null }>(memberships: { organization_id: string; role: string }[], orgs: T[]): T | null {
  const roleOf = new Map(memberships.map((m) => [m.organization_id, m.role]));
  const ranked = orgs
    .filter((o) => roleOf.has(o.id))
    .sort((a, b) => Number(roleOf.get(b.id) === "owner") - Number(roleOf.get(a.id) === "owner") || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id));
  return ranked[0] ?? null;
}
