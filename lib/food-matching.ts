// Pure logic for the Nutrition Spot's real accuracy layer
// (nutrition_spot_revamp_scoping_sept19.md) — the actual fix for the
// old "Mix & Macros" bug: an AI-suggested meal's macros were only ever
// the AI's own self-reported claim ("within about 10%"), never checked
// against real food data. This is the food-domain equivalent of
// lib/exercise-matching.ts's normalize+Jaccard approach, kept as its
// own module rather than reused directly — a different vocabulary
// (grocery ingredients vs. exercise names) with its own synonym/unit
// concerns, not worth coupling to the exercise-library domain.

// "Chicken Breast: 170g (~6.0 oz)" -> { name: "Chicken Breast", grams: 170 }.
// Deliberately requires an explicit gram amount — the AI's own system
// prompt is instructed to always give one, and a line with no parseable
// grams can't be verified against real food data at all, so it's
// treated as an unmatched/unconfident line by the caller rather than
// guessed at here.
export function parseIngredientLine(line: string): { name: string; grams: number } | null {
  const match = line.match(/^(.+?):\s*([\d.]+)\s*g\b/i);
  if (!match) return null;
  const name = match[1].trim();
  const grams = parseFloat(match[2]);
  if (!name || !Number.isFinite(grams) || grams <= 0) return null;
  return { name, grams };
}

const STOPWORDS = new Set(["and", "or", "with", "of", "the", "a", "an", "raw", "cooked"]);

export function normalizeFoodName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .sort()
    .join(" ");
}

// Asymmetric containment, not symmetric Jaccard — unlike matching one
// exercise name against another (both already short, coach-curated
// names, where Jaccard's own precedent in lib/exercise-matching.ts
// makes sense), a USDA description is a long, formal food-science
// string ("Chicken, broilers or fryers, breast, meat only, raw") being
// matched against a short common name ("Chicken Breast") — penalizing
// the candidate for its own extra descriptive words would make almost
// nothing ever score high. What actually matters here is "does the
// candidate contain everything the query is asking for": the fraction
// of the QUERY's own words found in the candidate.
function containmentScore(query: string, candidate: string): number {
  const querySet = new Set(query.split(" ").filter(Boolean));
  const candidateSet = new Set(candidate.split(" ").filter(Boolean));
  if (querySet.size === 0) return 0;
  let found = 0;
  for (const t of querySet) if (candidateSet.has(t)) found++;
  return found / querySet.size;
}

export function scoreFoodMatch(queryName: string, candidateDescription: string): number {
  return containmentScore(normalizeFoodName(queryName), normalizeFoodName(candidateDescription));
}

export interface FoodCandidate {
  fdcId: number;
  description: string;
}

export interface FoodMatch {
  fdcId: number;
  description: string;
  score: number;
}

// Same confidence bar as lib/exercise-matching.ts's own FUZZY_THRESHOLD
// (0.6) for an unattended auto-accept — this runs against AI output
// with no human review step in between, the same "silently trust it"
// situation that threshold was chosen for.
export const MIN_CONFIDENT_MATCH_SCORE = 0.6;

export function pickBestFoodMatch(queryName: string, candidates: FoodCandidate[]): FoodMatch | null {
  let best: FoodMatch | null = null;
  for (const c of candidates) {
    const score = scoreFoodMatch(queryName, c.description);
    if (!best || score > best.score) best = { fdcId: c.fdcId, description: c.description, score };
  }
  if (best && best.score >= MIN_CONFIDENT_MATCH_SCORE) return best;
  return null;
}

// The single broadest, most distinctive word to search the USDA table
// by (a cheap ilike prefilter before the real scoring pass) — the
// longest word in the normalized name, since short words like "raw" or
// "breast" alone cast too wide a net while the longest word is usually
// the most identifying ("chicken", "quinoa", "broccoli").
export function pickSearchTerm(name: string): string {
  const words = normalizeFoodName(name).split(" ").filter(Boolean);
  if (words.length === 0) return name.trim();
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), words[0]);
}
