// One way to read an exercise name (Ron, Oct 6): the same movement typed three ways ("Band Pull Apart", "Band Pull-Apart", "band pull-aparts") is one
// exercise, but two different movements that merely share a word ("Reverse Lunge", "Walking Lunge", "Lateral Lunge") are never merged. So this only
// collapses the differences that cannot change the movement:
//   * case, punctuation, hyphens and apostrophes ("Farmer's Carry" = "Farmers Carry"),
//   * plural against singular ("Dips" = "Dip", "Lunges" = "Lunge", "Presses" = "Press", "Flyes" = "Fly"),
//   * common abbreviations ("DB" = "dumbbell", "BB" = "barbell", "KB" = "kettlebell", "RDL" = "Romanian deadlift"),
//   * filler words ("the", "a", "exercise", "movement"),
//   * word order ("Incline Dumbbell Bench Press" = "Bench Press Incline Dumbbell").
// Anything else that differs (a qualifier in brackets, an equipment word, a direction) stays different. A name that is close but not identical is only
// SUGGESTED to the person choosing (top three), never matched silently.

const ABBREVIATIONS: Record<string, string[]> = {
  db: ["dumbbell"],
  dbs: ["dumbbell"],
  bb: ["barbell"],
  kb: ["kettlebell"],
  kbs: ["kettlebell"],
  rdl: ["romanian", "deadlift"],
  sldl: ["single", "leg", "romanian", "deadlift"],
  ohp: ["overhead", "press"],
  bw: ["bodyweight"],
  ez: ["ez"],
};

const FILLER = new Set(["the", "a", "an", "exercise", "movement", "drill"]);

// Words that end in s but are not a plural, and plurals that are spelled irregularly.
const KEEP = new Set(["press", "glutes", "abs", "lats", "delts", "biceps", "triceps", "quads", "calves", "ss", "cars", "iyt", "ez", "bars"]);
const IRREGULAR: Record<string, string> = { ups: "up", downs: "down", flyes: "fly", flys: "fly", flies: "fly", calves: "calf", lunges: "lunge", cars: "car", raises: "raise", presses: "press", swings: "swing" };

export function singular(word: string): string {
  if (word in IRREGULAR) return IRREGULAR[word];
  if (KEEP.has(word) && word !== "cars") return word;
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ches|shes|xes|sses|zzes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// The words of a name, in the form used for comparing: lowercase, no punctuation, singular, abbreviations spelled out, filler removed. Words inside
// brackets are kept: "(Rope)" or "(Straight Leg)" says which movement it is.
// Two words that are really one movement name, written either way ("lat pull down" / "lat pulldown", "push-up" / "pushup").
const COMPOUNDS: [RegExp, string][] = [
  [/\b(pull|push|chin|sit|step) ups?\b/g, "$1up"],
  [/\b(pull|push) downs?\b/g, "$1down"],
  [/\bpull aparts?\b/g, "pullapart"],
  [/\bpull overs?\b/g, "pullover"],
  [/\bhip thrusts?\b/g, "hipthrust"],
];

export function exerciseTokens(name: string): string[] {
  let text = name
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const [re, to] of COMPOUNDS) text = text.replace(re, to);
  const out: string[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (FILLER.has(raw)) continue;
    const expanded = ABBREVIATIONS[raw];
    if (expanded) {
      out.push(...expanded);
      continue;
    }
    out.push(singular(raw));
  }
  return out;
}

// The key two spellings of the same movement share. Word order does not matter.
export function canonicalKey(name: string): string {
  return [...exerciseTokens(name)].sort().join(" ");
}

// How alike two names are (0 to 1) when they are not the same key: the share of words they have in common. Used only to suggest, never to match.
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(exerciseTokens(a));
  const tb = new Set(exerciseTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export interface Suggestion {
  name: string;
  score: number;
}

// The three closest known names to what was typed, best first, above a floor so a weak guess is not offered. Never includes a name with the same key
// (that is the same exercise, handled before this is asked).
export function suggestExercises(typed: string, known: string[], limit = 3, floor = 0.5): Suggestion[] {
  const key = canonicalKey(typed);
  return known
    .filter((k) => canonicalKey(k) !== key)
    .map((k) => ({ name: k, score: nameSimilarity(typed, k) }))
    .filter((s) => s.score >= floor)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Groups names that share a key. Groups of one are left out.
export function sureDuplicates(names: string[]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const n of names) {
    const k = canonicalKey(n);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }
  return [...byKey.values()].filter((g) => g.length > 1);
}
