import type { ParsedImportRow } from "@/lib/workout-import-parser";

// A deterministic second look at the brief ("no jumping", "bad knees", "3x a week") against what the AI built, independent of the AI's own self-report. It only flags what a
// coach should double-check; it never changes anything. Pure; no database.

// What a named exclusion or concern covers, as words that appear in exercise names.
const CONCEPTS: { triggers: RegExp; label: string; words: string[]; concern?: boolean }[] = [
  { triggers: /\b(jump|jumping|jumps|plyo|plyometric|plyometrics)\b/, label: "jumping", words: ["jump", "plyo", "hop", "bound", "skip"] },
  { triggers: /\b(run|running|runs|sprint|sprinting|jog|jogging)\b/, label: "running", words: ["run", "sprint", "jog"] },
  { triggers: /\b(overhead|ohp)\b/, label: "overhead work", words: ["overhead", "military press", "push press", "jerk", "snatch", "handstand"] },
  { triggers: /\bbarbell/, label: "barbells", words: ["barbell"] },
  { triggers: /\bmachine/, label: "machines", words: ["machine", "smith"] },
  { triggers: /\bkettlebell/, label: "kettlebells", words: ["kettlebell"] },
  { triggers: /\bdumbbell/, label: "dumbbells", words: ["dumbbell"] },
  { triggers: /\bcable/, label: "cables", words: ["cable"] },
];
// A body area the brief says is injured or sore: movements that commonly load it, flagged "check this", not "wrong".
const CONCERNS: { triggers: RegExp; label: string; words: string[] }[] = [
  { triggers: /\b(bad|sore|injured|hurt|hurts|painful|sensitive)\s+(left\s+|right\s+)?knees?\b|\bknee\s+(pain|injury|issues?|problems?)\b/, label: "bad knees", words: ["jump", "plyo", "hop", "bound", "lunge", "pistol", "sissy", "leg extension", "step-up", "step up"] },
  { triggers: /\b(bad|sore|injured|hurt|hurts|painful)\s+(lower\s+)?back\b|\b(lower\s+)?back\s+(pain|injury|issues?|problems?)\b/, label: "a bad back", words: ["deadlift", "good morning", "bent over", "bent-over", "jump"] },
  { triggers: /\b(bad|sore|injured|hurt|hurts|painful)\s+(left\s+|right\s+)?shoulders?\b|\bshoulder\s+(pain|injury|issues?|problems?)\b/, label: "a bad shoulder", words: ["overhead", "military press", "upright row", "behind the neck", "dip", "snatch", "jerk"] },
];

const STOP = new Set(["the", "any", "more", "much", "too", "lots", "many", "extra", "a", "an", "of", "than", "time", "days", "day", "rest", "need", "sets", "reps", "weights", "weight"]);

function singular(w: string): string {
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

export function scanConstraints(brief: string, rows: ParsedImportRow[]): string[] {
  const text = brief.toLowerCase();
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s) && out.length < 20) out.push(s);
  };
  const named = (r: ParsedImportRow) => r.exerciseName.trim().toLowerCase();
  const at = (r: ParsedImportRow) => `${r.week}, ${r.day}`;

  // "no X", "avoid X", "without X", "exclude X", "skip X" (X = the next one or two words).
  const excluded = new Set<string>();
  for (const m of text.matchAll(/\b(?:no|avoid|avoiding|without|exclude|excluding|skip|never)\s+([a-z-]+)(?:\s+([a-z-]+))?/g)) {
    for (const w of [m[1], m[2]]) {
      if (w && w.length >= 4 && !STOP.has(w)) excluded.add(singular(w));
    }
  }
  const exclusionPhrases = [...text.matchAll(/\b(?:no|avoid|avoiding|without|exclude|excluding|skip|never)\s+([a-z-]+(?:\s+[a-z-]+)?)/g)].map((m) => m[1]);
  for (const c of CONCEPTS) {
    if (!exclusionPhrases.some((p) => c.triggers.test(p))) continue;
    for (const r of rows) {
      if (c.words.some((w) => named(r).includes(w))) add(`"${r.exerciseName}" (${at(r)}) conflicts with "no ${c.label}" in your description.`);
    }
  }
  for (const word of excluded) {
    for (const r of rows) {
      if (named(r).includes(word)) add(`"${r.exerciseName}" (${at(r)}) contains "${word}", which your description said to leave out.`);
    }
  }
  for (const c of CONCERNS) {
    if (!c.triggers.test(text)) continue;
    for (const r of rows) {
      if (c.words.some((w) => named(r).includes(w))) add(`"${r.exerciseName}" (${at(r)}) may be hard on ${c.label}, which your description mentioned. Check it.`);
    }
  }

  // "3x a week", "3x/week", "4 days a week", "five days per week".
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const per = /\b(\d|one|two|three|four|five|six|seven)\s*(?:x|times|days?)\s*(?:a|per|\/|each)?\s*(?:week|wk)\b/.exec(text);
  if (per) {
    const want = words[per[1]] ?? Number(per[1]);
    const daysByWeek = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = daysByWeek.get(r.week) ?? new Set<string>();
      s.add(r.day);
      daysByWeek.set(r.week, s);
    }
    for (const [week, days] of daysByWeek) {
      if (days.size !== want) add(`${week} has ${days.size} training days, but your description asked for ${want} a week.`);
    }
  }
  return out;
}
