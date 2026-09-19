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

// Cheap plural destemming — real mismatch found live: a query like
// "Eggs" (plural, how the AI writes it) scored zero containment against
// a real candidate description "Egg, whole, raw, fresh" (singular) even
// though they're the same food, since plain substring/word-overlap
// matching treats "eggs" and "egg" as unrelated tokens. Stripping one
// trailing "s" from words over 3 letters (skips short words/acronyms
// like "oz") isn't a real stemmer, but it's enough to unify the common
// singular/plural pairs this domain actually produces (egg/eggs,
// onion/onions, bean/beans) without meaningfully colliding anything.
function destem(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function normalizeFoodName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(destem)
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

// Real scaling issue found once the live USDA table went from 2 rows to
// 8,262: two candidates can both fully contain the query's words (score
// 1.0) while one is a plain, precise match ("Rice, brown, long-grain,
// cooked") and the other is a compound/blended product that happens to
// mention the same words in passing ("Snacks, rice cakes, brown rice,
// sesame seed" for a "Brown Rice" query). Pure containment can't tell
// these apart — it only checks the query's words are present, never
// penalizes the candidate's OWN extra words. Tie-break on candidate
// word count as a secondary key: among equally-containing candidates,
// the one closest in length to the query itself is the more literal,
// specific match, not a bigger product name that happens to mention it.
// A generic ingredient name with no prep description ("Chicken Breast",
// "Brown Rice") conventionally means the raw/uncooked form — how a real
// recipe or grocery list states an ingredient before cooking, and the
// AI's own system prompt already asks for "real, common grocery-store
// ingredients." A raw entry gets a tiebreak preference over an equally-
// containing but more specific/processed one ("...tenders, breaded,
// cooked, microwaved") that happens to mention the same words.
function isRawEntry(description: string): boolean {
  return /\braw\b/i.test(description);
}

export function pickBestFoodMatch(queryName: string, candidates: FoodCandidate[]): FoodMatch | null {
  const normalizedQuery = normalizeFoodName(queryName);
  let best: (FoodMatch & { wordCount: number; isRaw: boolean }) | null = null;
  for (const c of candidates) {
    const normalizedCandidate = normalizeFoodName(c.description);
    const score = containmentScore(normalizedQuery, normalizedCandidate);
    const wordCount = normalizedCandidate.split(" ").filter(Boolean).length;
    const isRaw = isRawEntry(c.description);
    const better =
      !best ||
      score > best.score ||
      (score === best.score && isRaw && !best.isRaw) ||
      (score === best.score && isRaw === best.isRaw && wordCount < best.wordCount);
    if (better) best = { fdcId: c.fdcId, description: c.description, score, wordCount, isRaw };
  }
  if (best && best.score >= MIN_CONFIDENT_MATCH_SCORE) return { fdcId: best.fdcId, description: best.description, score: best.score };
  return null;
}

// The normalized, deduped, stopword-free words to search the USDA table
// by. Real scaling issue found once the live table went from 2 rows to
// 8,262: searching by only the single longest word (e.g. "chicken" for
// "Chicken Breast") returns a huge, effectively-arbitrary candidate pool
// once .limit()-capped — the true "chicken breast" rows can easily fall
// outside the first N rows Postgres happens to return, since nothing
// orders that result by relevance. Requiring EVERY significant word to
// be present (the caller ANDs an ilike per word) shrinks the pool to
// genuinely relevant candidates directly, instead of hoping the best one
// survives a row-limit lottery.
export function significantWords(name: string): string[] {
  return normalizeFoodName(name).split(" ").filter(Boolean);
}
