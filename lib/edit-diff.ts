// What the coach changed in an AI draft before signing it off, worked out from two lists of the same shape: what the AI wrote (saved when the draft was created) and what is in
// the program now. Pure; no database.

export interface DraftRow {
  week: number;
  day: number; // day_index inside the week
  order: number; // position in the day, 0-based
  name: string;
  sets: number;
  reps: string | null;
}

export type EditKind = "swap" | "sets_reps" | "order" | "removed" | "added";

export interface EditEvent {
  kind: EditKind;
  from: string | null;
  to: string | null;
  detail: Record<string, unknown> | null;
}

const key = (name: string) => name.trim().toLowerCase();

export function diffDraft(before: DraftRow[], after: DraftRow[]): EditEvent[] {
  const events: EditEvent[] = [];
  const days = new Set([...before, ...after].map((r) => `${r.week}|${r.day}`));
  for (const d of days) {
    const [week, day] = d.split("|").map(Number);
    const b = before.filter((r) => r.week === week && r.day === day).sort((x, y) => x.order - y.order);
    const a = after.filter((r) => r.week === week && r.day === day).sort((x, y) => x.order - y.order);
    const aKeys = new Set(a.map((r) => key(r.name)));
    const bKeys = new Set(b.map((r) => key(r.name)));

    // Exercises in both: did the sets or reps change?
    for (const r of b) {
      const now = a.find((x) => key(x.name) === key(r.name));
      if (!now) continue;
      if (now.sets !== r.sets || (now.reps ?? "") !== (r.reps ?? "")) {
        events.push({ kind: "sets_reps", from: r.name, to: r.name, detail: { week, day, before: { sets: r.sets, reps: r.reps }, after: { sets: now.sets, reps: now.reps } } });
      }
    }
    // Order: the shared exercises, in the order each list has them.
    const sharedBefore = b.filter((r) => aKeys.has(key(r.name))).map((r) => key(r.name));
    const sharedAfter = a.filter((r) => bKeys.has(key(r.name))).map((r) => key(r.name));
    if (sharedBefore.join("|") !== sharedAfter.join("|")) events.push({ kind: "order", from: null, to: null, detail: { week, day } });

    // Gone and new: when the same number of each is left, pair them by position (a swap); the rest are plain removals and additions.
    const removed = b.filter((r) => !aKeys.has(key(r.name)));
    const added = a.filter((r) => !bKeys.has(key(r.name)));
    const pairs = Math.min(removed.length, added.length);
    // A single removal with a single addition is a swap whatever the positions; with several, match the nearest positions.
    const freeAdded = [...added];
    for (const r of removed.slice(0, pairs)) {
      let best = 0;
      for (let i = 1; i < freeAdded.length; i++) {
        if (Math.abs(freeAdded[i].order - r.order) < Math.abs(freeAdded[best].order - r.order)) best = i;
      }
      const [to] = freeAdded.splice(best, 1);
      events.push({ kind: "swap", from: r.name, to: to.name, detail: { week, day } });
    }
    for (const r of removed.slice(pairs)) events.push({ kind: "removed", from: r.name, to: null, detail: { week, day } });
    for (const r of freeAdded) events.push({ kind: "added", from: null, to: r.name, detail: { week, day } });
  }
  return events;
}
