// Adding a machine to the shared list from the admin page (Ron, Nov 21: "I have a lot of the exercises named already with the machine in the name. So if I go to add a machine, if I
// type in hammer strength, it'd be cool if it popped up a list of all of the exercises I have that have hammer strength in it"). While the brand or the machine's name is typed, his
// own exercises whose name holds that phrase are listed, each ticked; on save the ticked ones go on the machine with their demos. Only on the platform admin's own page. Pure, so it
// is tested (lib/machine-add-suggest.test.ts).

export const SUGGEST_MIN_CHARS = 3;

export interface SuggestRow {
  id: string;
  name: string;
  videoPath: string | null;
  youtubeUrl: string | null;
}

function tidy(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function key(raw: string): string {
  return tidy(raw).toLowerCase();
}

export function hasDemo(row: SuggestRow): boolean {
  return !!row.videoPath || !!(row.youtubeUrl && row.youtubeUrl.trim());
}

// The library exercises whose name holds the brand or the machine's name typed (the whole phrase, any case, 3 or more characters): "hammer strength" finds "Hammer Strength Iso
// Row". One row a name (the one with a demo when two share it), by name. `skipNames` are names already on the machine or already in the form's own list.
export function matchLibraryExercises<T extends SuggestRow>(library: T[], phrases: string[], skipNames: Iterable<string> = []): T[] {
  const terms = [...new Set(phrases.map(key).filter((p) => p.length >= SUGGEST_MIN_CHARS))];
  if (terms.length === 0) return [];
  const skip = new Set([...skipNames].map(key));
  const byName = new Map<string, T>();
  for (const row of library) {
    const k = key(row.name);
    if (!k || skip.has(k) || !terms.some((t) => k.includes(t))) continue;
    const had = byName.get(k);
    if (!had || (!hasDemo(had) && hasDemo(row))) byName.set(k, row);
  }
  return [...byName.values()].sort((a, b) => tidy(a.name).localeCompare(tidy(b.name)));
}

// The suggestions shown in the add-machine form: only for the platform admin on the admin page (a coach's form sends a request and is unchanged).
export function machineSuggestions<T extends SuggestRow>({
  show,
  library,
  brand,
  model,
  skipNames = [],
}: {
  show: boolean;
  library: T[];
  brand: string;
  model: string;
  skipNames?: Iterable<string>;
}): T[] {
  if (!show) return [];
  return matchLibraryExercises(library, [brand, model], skipNames);
}

// Every match starts ticked: the form keeps the ones he unticked, so a match that appears while he types is ticked without anything to do.
export function tickedRows<T extends SuggestRow>(matches: T[], unticked: ReadonlySet<string>): T[] {
  return matches.filter((m) => !unticked.has(m.id));
}

// "Untick all" when every match is ticked, else "Tick all"; the new unticked set after the tap.
export function allTicked(matches: SuggestRow[], unticked: ReadonlySet<string>): boolean {
  return matches.every((m) => !unticked.has(m.id));
}
export function toggleAll(matches: SuggestRow[], unticked: ReadonlySet<string>): Set<string> {
  const next = new Set(unticked);
  if (allTicked(matches, unticked)) for (const m of matches) next.add(m.id);
  else for (const m of matches) next.delete(m.id);
  return next;
}

export function matchesLine(n: number): string {
  return `${n} ${n === 1 ? "match" : "matches"} in your exercises`;
}

// The exercises sent for the machine: the ticked ones (each by its name, with the exercise catalog's id when the catalog has that exact name, as "Add" does), then the ones typed in
// the form, without the same name twice.
export function mergeMachineExercises(
  ticked: SuggestRow[],
  typed: { name: string; catalogId: string | null }[],
  catalogNames: { id: string; name: string }[],
): { name: string; catalogId: string | null }[] {
  const catalogId = new Map<string, string>();
  for (const n of catalogNames) if (!catalogId.has(key(n.name))) catalogId.set(key(n.name), n.id);
  const seen = new Set<string>();
  const out: { name: string; catalogId: string | null }[] = [];
  for (const r of ticked) {
    const name = tidy(r.name);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push({ name, catalogId: catalogId.get(key(name)) ?? null });
  }
  for (const e of typed) {
    if (seen.has(key(e.name))) continue;
    seen.add(key(e.name));
    out.push(e);
  }
  return out;
}

// Which permission ticks the ticked demos need (the same ones "use one of my demos" asks for): a filmed video needs "I filmed this" and the on-camera consent; a YouTube link its own.
export function demoTicksNeeded(ticked: SuggestRow[]): { video: boolean; link: boolean } {
  return {
    video: ticked.some((r) => !!r.videoPath),
    link: ticked.some((r) => !r.videoPath && !!(r.youtubeUrl && r.youtubeUrl.trim())),
  };
}

// After the machine is saved: each ticked exercise with a demo, paired with its new exercise on the shared machine (by name; one already on the machine before is never touched).
// `missing` is a ticked demo whose exercise could not be found on the machine.
export function planDemoCarry<T extends SuggestRow>(
  ticked: T[],
  machineItems: { id: string; name: string }[] | null,
  priorItemIds: Iterable<string>,
): { carry: { itemId: string; row: T }[]; missing: T[] } {
  const prior = new Set(priorItemIds);
  const itemByName = new Map<string, string>();
  for (const i of machineItems ?? []) if (!prior.has(i.id) && !itemByName.has(key(i.name))) itemByName.set(key(i.name), i.id);
  const carry: { itemId: string; row: T }[] = [];
  const missing: T[] = [];
  for (const row of ticked) {
    if (!hasDemo(row)) continue;
    const itemId = itemByName.get(key(row.name));
    if (itemId) carry.push({ itemId, row });
    else missing.push(row);
  }
  return { carry, missing };
}

// The plain line when some demos did not come along: the machine and its exercises are on the list either way.
export function demoFailedLine(names: string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The ${names.length === 1 ? "demo" : "demos"} for ${list} didn't come along. Open the machine below and add ${names.length === 1 ? "it" : "them"} with "Add demo".`;
}

// Same brand and model as one already on the list (the list keeps one of each, any case).
export function sameMachine(a: { brand: string; model: string }, b: { brand: string; model: string }): boolean {
  return key(a.brand) === key(b.brand) && key(a.model) === key(b.model);
}
