// Machines in the exercise library (Ron, Nov 19: "on a machine I could put a QR code and it'll show you all of the exercise variations for that machine"). A machine is a name and the
// coach's own exercises done on it, in order; its QR code opens /scan/machine/<id>, which lists them, each opening the exercise's own scan page. Pure, so it is tested.
export const MACHINE_NAME_MAX = 80;

export interface MachineRow {
  id: string;
  name: string;
  // The exercises on it, in order.
  exerciseIds: string[];
  // Where the next exercise added goes (after every saved one, even after removals).
  nextPos: number;
  // Added from the shared machine list (migration 0453): the shared machine, and for each exercise the shared one it came from, whose demo is shown (read live).
  catalogMachineId?: string | null;
  catalogItemByExercise?: Record<string, string>;
}

export function machineScanPath(machineId: string): string {
  return `/scan/machine/${machineId}`;
}

// A machine's name as it is saved: spaces tidied, 1 to 80 characters (the database checks the same).
export function cleanMachineName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Give the machine a name." };
  if (name.length > MACHINE_NAME_MAX) return { ok: false, error: `Keep the name to ${MACHINE_NAME_MAX} characters.` };
  return { ok: true, name };
}

// Where a newly added exercise goes: after the last one.
export function nextPosition(positions: number[]): number {
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

// The coach's machines from their rows: each machine's exercises in their saved order (then by name, so the order is the same on every screen). An exercise no longer in the library is
// left out (the database removes its row with it).
export function machinesFromRows(
  machines: { id: string; name: string; catalog_machine_id?: string | null }[],
  links: { machine_id: string; exercise_id: string; position: number; catalog_item_id?: string | null }[],
  libraryIds: Set<string>,
): MachineRow[] {
  return machines.map((m) => ({
    id: m.id,
    name: m.name,
    catalogMachineId: m.catalog_machine_id ?? null,
    catalogItemByExercise: Object.fromEntries(links.filter((l) => l.machine_id === m.id && l.catalog_item_id).map((l) => [l.exercise_id, l.catalog_item_id as string])),
    nextPos: nextPosition(links.filter((l) => l.machine_id === m.id).map((l) => l.position)),
    exerciseIds: links
      .filter((l) => l.machine_id === m.id && libraryIds.has(l.exercise_id))
      .sort((a, b) => a.position - b.position || a.exercise_id.localeCompare(b.exercise_id))
      .map((l) => l.exercise_id),
  }));
}

// The public list's rows, in the machine's order (only exercises that still exist), each with the shared-list exercise it came from (null for the coach's own).
export function scanRows<T extends { id: string }>(links: { exercise_id: string; position: number; catalog_item_id?: string | null }[], exercises: T[]): (T & { catalogItemId: string | null })[] {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return [...links]
    .sort((a, b) => a.position - b.position)
    .map((l) => {
      const e = byId.get(l.exercise_id);
      return e ? { ...e, catalogItemId: l.catalog_item_id ?? null } : null;
    })
    .filter((e): e is T & { catalogItemId: string | null } => !!e);
}
