// The builder checks its own day with the Programming Spotter before the coach sees it (reports/spotter-builder-crosscheck-ORDER.md, Part 2, Nov 24; Ron: the Spotter and the
// builder should "cross-check one another"). The same pure checks the Spotter runs on a saved program (lib/programming-spotter.ts), on ONE drafted day:
//  * three or more same-pattern exercises back to back, and three or more single-joint exercises on one joint action (both per day);
//  * a note the coach already said no to on this program (programming_spotter_dismissals) is never raised or "fixed";
//  * a note on an exercise the coach named is theirs to decide, so it is left alone;
//  * a real problem gets ONE repair try (with the build-day route's own retry, never a loop); what the builder keeps on purpose is one short line in the chat.
// Coach-only: these lines go to the coach's builder chat and nowhere else.
import { detectBiomechRedundancy, detectRedundancy, type SpotterCategory, type SpotterTier } from "./programming-spotter";

export interface DayLookups {
  patternByName: Map<string, { id: string; tier: SpotterTier | null }>;
  tagsByName: Map<string, { keys: string[]; joints: (string | null)[] }>;
  categoryByName: Map<string, SpotterCategory | null>;
}

export interface DayNote {
  // the Spotter's own dismissal key, `${checkKind}::${patternKey}` (the same key a Deny in the Spotter saves)
  key: string;
  names: string[];
  // what is wrong, for the repair note and the chat line: "Seated Cable Row, Chest Supported Row and Bent Over Barbell Row back to back on the same movement pattern"
  problem: string;
}

export const MAX_KEPT_LINES = 3;

export function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const tagWords = (tagKey: string) => tagKey.replace(/^scapula_/, "shoulder blade ").replace(/_/g, " ");

export function dayNotes(rows: { exerciseName: string; coachNamed?: boolean }[], info: DayLookups, dismissed: ReadonlySet<string>): DayNote[] {
  const coachNamed = new Set(rows.filter((r) => r.coachNamed).map((r) => r.exerciseName));
  const slots = rows.map((r, i) => ({
    exerciseName: r.exerciseName,
    category: info.categoryByName.get(r.exerciseName) ?? null,
    tier: info.patternByName.get(r.exerciseName)?.tier ?? null,
    movementPatternId: info.patternByName.get(r.exerciseName)?.id ?? null,
    setCount: 1,
    slotIndex: i,
    slotCountInSession: rows.length,
    weekNumber: 1,
    workoutId: "draft",
    dayIndex: 1,
  }));
  const tagged = rows.map((r) => ({
    exerciseName: r.exerciseName,
    weekNumber: 1,
    workoutId: "draft",
    dayIndex: 1,
    primeMoverTagKeys: info.tagsByName.get(r.exerciseName)?.keys ?? [],
    primeMoverJoints: info.tagsByName.get(r.exerciseName)?.joints ?? [],
    category: info.categoryByName.get(r.exerciseName) ?? null,
  }));
  const notes: DayNote[] = [
    ...detectRedundancy(slots).map((f) => ({ key: `redundancy::${f.movementPatternId}`, names: f.exerciseNames, problem: `${listNames(f.exerciseNames)} back to back on the same movement pattern` })),
    ...detectBiomechRedundancy(tagged).map((f) => ({ key: `biomech_redundancy::${f.tagKey}`, names: f.exerciseNames, problem: `${listNames(f.exerciseNames)}, all single-joint ${tagWords(f.tagKey)} work` })),
  ];
  return notes.filter((n) => !dismissed.has(n.key) && !n.names.some((name) => coachNamed.has(name)));
}

// The one repair try, added to the day's retry note.
export function repairNote(notes: DayNote[]): string | null {
  if (notes.length === 0) return null;
  return `Your last try for this day stacks the same work: ${notes.map((n) => n.problem).join("; ")}. Write the day again with that work covered by fewer exercises (about the same total sets), unless the coach's request calls for that much of it on this day (for example a glute focus or an arms day). If you keep any of it on purpose, add one more top-level field, "kept": a few words on why, for example "back focus".`;
}

// The chat line for a note the day still has: why it was kept, or (no reason given, or no time to try again) that it is worth a look.
export function keptLine(note: DayNote, slot: { week: number; day: number }, reason: string | null): string {
  const where = `week ${slot.week}, day ${slot.day}`;
  return reason ? `Kept ${listNames(note.names)} in ${where}: ${reason.replace(/[.\s]+$/, "")}.` : `${where[0].toUpperCase()}${where.slice(1)} has ${note.problem}. Worth a look.`;
}

// The model's "kept" reason: plain text, one short line.
export function readKept(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 80) : null;
}

// Which version of the day to keep after the one retry: fewer "leave out" breaks first, then no more Spotter notes than before.
export function takeRetry(first: { hard: number; notes: number }, second: { hard: number; notes: number }): boolean {
  return second.hard < first.hard || (second.hard === first.hard && second.notes <= first.notes);
}
