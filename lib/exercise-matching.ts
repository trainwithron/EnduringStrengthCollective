// Fuzzy/synonym exercise-name matching for the workout importer. Pure —
// no DB access; the caller supplies the coach's real library + learned
// aliases and gets back a match with a confidence bucket to color-code.

export interface LibraryExercise {
  name: string;
}

export interface AliasEntry {
  rawName: string;
  exerciseName: string;
}

export type MatchConfidence = "exact" | "alias" | "fuzzy" | "none";

export interface MatchResult {
  exerciseName: string | null;
  confidence: MatchConfidence;
  score: number; // 0-1
}

// Common abbreviations and cross-platform synonyms. Keys are checked both
// as a whole normalized phrase (multi-word synonyms) and per-token
// (abbreviations) — see normalizeName.
const PHRASE_SYNONYMS: Record<string, string> = {
  "bulgarian split squat": "rear foot elevated split squat",
};

const TOKEN_SYNONYMS: Record<string, string> = {
  db: "dumbbell",
  bb: "barbell",
  ohp: "overhead press",
  rdl: "romanian deadlift",
  sldl: "stiff leg deadlift",
  bp: "bench press",
};

function stripAndCollapse(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Order-invariant canonical key: strips punctuation, expands known
// abbreviations/synonyms, then sorts tokens — so "Barbell Back Squat" and
// "Back Squats, Barbell" normalize identically regardless of word order.
export function normalizeName(raw: string): string {
  let s = stripAndCollapse(raw);
  if (!s) return "";
  if (PHRASE_SYNONYMS[s]) s = PHRASE_SYNONYMS[s];

  const expanded = s
    .split(" ")
    .flatMap((t) => (TOKEN_SYNONYMS[t] ?? t).split(" "))
    .filter(Boolean);

  return expanded.slice().sort().join(" ");
}

function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// 0.5 (a bare majority) turned out to be too permissive in practice: two
// completely different exercises sharing just an equipment word and a
// generic movement word (e.g. "Barbell Bench Press" vs "Barbell Overhead
// Press" — both share "barbell" and "press") land at exactly 0.5 and get
// silently treated as the same exercise. 0.6 keeps genuine near-duplicates
// (e.g. "Seated Row" vs "Seated Cable Row", a strict superset) while
// rejecting that class of false positive.
const FUZZY_THRESHOLD = 0.6;

export function matchExercise(
  rawName: string,
  library: LibraryExercise[],
  aliases: AliasEntry[]
): MatchResult {
  const normalizedRaw = normalizeName(rawName);
  if (!normalizedRaw) return { exerciseName: null, confidence: "none", score: 0 };

  const alias = aliases.find((a) => normalizeName(a.rawName) === normalizedRaw);
  if (alias) {
    return { exerciseName: alias.exerciseName, confidence: "alias", score: 1 };
  }

  const exact = library.find((l) => normalizeName(l.name) === normalizedRaw);
  if (exact) {
    return { exerciseName: exact.name, confidence: "exact", score: 1 };
  }

  let best: { name: string; score: number } | null = null;
  for (const l of library) {
    const score = jaccard(normalizedRaw, normalizeName(l.name));
    if (!best || score > best.score) best = { name: l.name, score };
  }

  if (best && best.score >= FUZZY_THRESHOLD) {
    return { exerciseName: best.name, confidence: "fuzzy", score: best.score };
  }

  return { exerciseName: null, confidence: "none", score: best?.score ?? 0 };
}

export function confidenceBucket(confidence: MatchConfidence): "green" | "yellow" | "red" {
  if (confidence === "exact" || confidence === "alias") return "green";
  if (confidence === "fuzzy") return "yellow";
  return "red";
}
