// Supersets and circuits (Ron, Nov 20: B1). An exercise can be linked with the NEXT exercise of its day (group_workout_exercises.superset_next): linked exercises are done back to back, one
// set of each, and the rest comes after the round. Two linked exercises are a superset, three or more a circuit. Each block of the day is numbered (a lone exercise is a block of its own) and the
// exercises of a linked block are lettered: 1, 2a, 2b, 3. A note between two exercises ends a link (the note belongs to the day, between them), as does the end of the day.

export interface SupersetItem {
  id: string;
  kind?: "exercise" | "note";
  supersetNext?: boolean;
}

export interface SupersetPlace {
  // "2a"
  label: string;
  // the exercises of the block, in order (ids)
  members: string[];
  index: number;
}

/** Each linked exercise's place: its label and its block. A lone exercise has none. `items` in the day's order. */
export function supersetPlaces(items: SupersetItem[]): Map<string, SupersetPlace> {
  const out = new Map<string, SupersetPlace>();
  let block = 0;
  let current: string[] = [];
  const close = () => {
    if (current.length >= 2) current.forEach((id, i) => out.set(id, { label: `${block}${String.fromCharCode(97 + Math.min(i, 25))}`, members: current, index: i }));
    current = [];
  };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "note") {
      close();
      continue;
    }
    if (current.length === 0) block += 1;
    current.push(item.id);
    const next = items[i + 1];
    if (!(item.supersetNext && next && next.kind !== "note")) close();
  }
  close();
  return out;
}

/** Whether a link can be offered on this exercise: there is an exercise straight after it. */
export function canLinkWithNext(items: SupersetItem[], id: string): boolean {
  const i = items.findIndex((x) => x.id === id);
  return i >= 0 && i < items.length - 1 && items[i + 1].kind !== "note" && items[i].kind !== "note";
}

/** "Superset" for two, "Circuit" for three or more. */
export function blockKind(size: number): string {
  return size >= 3 ? "Circuit" : "Superset";
}

// In the client's workout: after a set of one exercise in a linked block, where to go next and whether to rest. The next exercise of the block that still has a set to do, going round; the
// rest comes only once the round is done (no later exercise of the block has a set left in this round), and the round starts again at the first exercise of the block with a set left.
export function afterSupersetSet(
  members: { id: string; setsLeft: number }[],
  doneId: string
): { rest: boolean; nextId: string | null } {
  const i = members.findIndex((m) => m.id === doneId);
  if (i < 0) return { rest: true, nextId: null };
  const later = members.slice(i + 1).find((m) => m.setsLeft > 0);
  if (later) return { rest: false, nextId: later.id };
  const first = members.find((m) => m.setsLeft > 0);
  return { rest: true, nextId: first?.id ?? null };
}

/** The line under a linked exercise in the client's workout: "Superset with Row: one set of each, then rest." */
export function supersetLine(size: number, otherNames: string[]): string {
  const others = otherNames.length <= 1 ? otherNames.join("") : `${otherNames.slice(0, -1).join(", ")} and ${otherNames[otherNames.length - 1]}`;
  return size >= 3 ? `Circuit with ${others}: one set of each in turn, then rest.` : `Superset with ${others}: one set of each, then rest.`;
}
