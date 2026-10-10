// What the AI program builder is told about the coach: which exercises exist and how they are grouped (movement pattern, tier, category), and how this coach actually builds a
// session. Pure; no database. The route does the reading and hands the rows here.

export const MAX_LIBRARY_NAMES = 300;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Whole-word(s) match: "press" is not found inside "impress", and "Row" is not found in "Arrow". Used to see whether the coach's own description names an exercise.
export function mentionsExercise(brief: string, exerciseName: string): boolean {
  const n = norm(exerciseName);
  if (!n) return false;
  return ` ${norm(brief)} `.includes(` ${n} `);
}

const STOP = new Set(["the", "and", "for", "with", "week", "weeks", "day", "days", "program", "build", "make", "per", "from", "that", "this", "each", "one", "two", "three", "four", "five", "six"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));

export interface LibraryItem {
  name: string;
  category: string | null;
  pattern: string | null;
  tier: string | null;
}

// When the library is bigger than the builder can be shown, keep the most relevant, not the first alphabetically: exercises the description names, then ones sharing words with it,
// then the main lifts (tier A), then ones this coach already uses. `used` counts how often each exercise appears in their programs.
export function rankLibrary(items: LibraryItem[], brief: string, used: Map<string, number> = new Map(), max: number = MAX_LIBRARY_NAMES): LibraryItem[] {
  if (items.length <= max) return [...items].sort((a, b) => a.name.localeCompare(b.name));
  const briefTokens = new Set(tokens(brief));
  const scored = items.map((it) => {
    let score = 0;
    if (mentionsExercise(brief, it.name)) score += 10;
    score += tokens(it.name).filter((t) => briefTokens.has(t)).length * 2;
    if (it.tier === "A") score += 1;
    else if (it.tier === "B") score += 0.5;
    score += Math.min(3, used.get(it.name.toLowerCase()) ?? 0) * 0.3;
    return { it, score };
  });
  scored.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name));
  return scored.slice(0, max).map((s) => s.it).sort((a, b) => a.name.localeCompare(b.name));
}

// The exercise list as the builder reads it: grouped by movement pattern with the tier (A = main lifts, B = secondary, C = accessories), then the rest by category.
export function libraryContext(items: LibraryItem[], totalInLibrary: number): string {
  if (items.length === 0) return "(empty - invent sensible exercise names)";
  const byPattern = new Map<string, LibraryItem[]>();
  const rest = new Map<string, string[]>();
  for (const it of items) {
    if (it.pattern) {
      const list = byPattern.get(it.pattern) ?? [];
      list.push(it);
      byPattern.set(it.pattern, list);
    } else {
      const k = it.category ?? "Other";
      rest.set(k, [...(rest.get(k) ?? []), it.name]);
    }
  }
  const lines: string[] = [];
  for (const [pattern, list] of [...byPattern.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tiers = ["A", "B", "C", ""]
      .map((t) => {
        const names = list.filter((i) => (i.tier ?? "") === t).map((i) => i.name);
        return names.length > 0 ? `${t ? `tier ${t}` : "no tier"}: ${names.join(", ")}` : null;
      })
      .filter((x): x is string => !!x);
    lines.push(`- ${pattern} (${tiers.join("; ")})`);
  }
  for (const [category, names] of [...rest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${category}, not in a movement pattern: ${names.join(", ")}`);
  if (totalInLibrary > items.length) lines.push(`(showing the ${items.length} most relevant of ${totalInLibrary} exercises in this library)`);
  return lines.join("\n");
}

export interface ProfileSession {
  exercises: { name: string; sets: number; reps: string | null }[];
}

// How this coach builds a session, from their own programs: the order of movement patterns in their most common sessions, and the sets x reps they usually give each pattern.
// Needs at least three sessions to say anything. `slotOf` gives the movement pattern (or the category) of an exercise name.
export function buildProgrammingProfile(sessions: ProfileSession[], slotOf: (exerciseName: string) => string | null): string | null {
  const usable = sessions.filter((s) => s.exercises.length >= 2);
  if (usable.length < 3) return null;
  const shapes = new Map<string, { slots: string[]; count: number }>();
  const schemes = new Map<string, Map<string, number>>();
  let total = 0;
  for (const s of usable) {
    const slots = s.exercises.map((e) => slotOf(e.name) ?? "Other");
    const key = slots.join(" > ");
    const entry = shapes.get(key) ?? { slots, count: 0 };
    entry.count += 1;
    shapes.set(key, entry);
    total += s.exercises.length;
    s.exercises.forEach((e, i) => {
      const scheme = `${e.sets}x${e.reps ?? "?"}`;
      const m = schemes.get(slots[i]) ?? new Map<string, number>();
      m.set(scheme, (m.get(scheme) ?? 0) + 1);
      schemes.set(slots[i], m);
    });
  }
  const top = [...shapes.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  const lines = [`Typical session shapes (movement patterns in the order this coach uses them), from ${usable.length} of their sessions:`];
  top.forEach((t, i) => lines.push(`${i + 1}. ${t.slots.join(" > ")} (${t.count} ${t.count === 1 ? "session" : "sessions"})`));
  const common = [...schemes.entries()]
    .map(([slot, m]) => {
      const [scheme, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      return { slot, scheme, n };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  lines.push(`Sets x reps this coach usually gives each: ${common.map((c) => `${c.slot} ${c.scheme}`).join("; ")}.`);
  lines.push(`About ${Math.round(total / usable.length)} exercises per session.`);
  return lines.join("\n");
}
