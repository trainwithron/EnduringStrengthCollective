// The Programs page is one flat list with a single "Filter by" control. Pure, so it is tested.
//   All programs    = the library programs and the programs built straight for one client (a client's own COPY of a library program is not in this list: it is under the program's "Assigned to")
//   Shared programs = the library programs only
//   One client      = that client's programs: the ones built for them and their copies of library programs
//   Program type    = the default list, narrowed to one training type
//   Templates       = the library programs that contain at least one slot ("Hinge, unilateral, class A") to be filled in when the program is assigned

export type ProgramsFilterMode = "all" | "shared" | "client" | "type" | "templates" | "removed";

// A program the coach removed (hid): kept, with its history, until he deletes it.
export interface RemovedProgram {
  id: string;
  name: string;
  groupId: string;
  athleteId: string | null;
  athleteName: string | null;
}

// Which removed programs show: all of them under "Removed programs", and a client's own under "One client" (so nothing a coach removed can be lost from view).
export function removedFor(removed: RemovedProgram[], mode: ProgramsFilterMode, value: string | null): RemovedProgram[] {
  if (mode === "removed") return removed;
  if (mode === "client" && value) return removed.filter((r) => r.athleteId === value);
  return [];
}

export interface FilterableProgram {
  id: string;
  athleteId: string | null;
  athleteName: string | null;
  sourceProgramId?: string | null;
  trainingIntent?: string | null;
  updatedAt?: string | null;
  // How many template slots the program holds (library programs only).
  slotCount?: number;
}

export const isClientCopy = (p: FilterableProgram): boolean => !!p.athleteId && !!p.sourceProgramId;

// The default list: library programs and one-client programs (including one handed to its first person), never client copies; except a copy whose source is not in the list (archived, or
// in another organization), which would otherwise be in no list at all.
export function defaultList<T extends FilterableProgram>(all: T[]): T[] {
  const ids = new Set(all.map((p) => p.id));
  return all.filter((p) => !isClientCopy(p) || !ids.has(p.sourceProgramId as string));
}

export function applyProgramsFilter<T extends FilterableProgram>(all: T[], mode: ProgramsFilterMode, value: string | null): T[] {
  const list = defaultList(all);
  if (mode === "removed") return [];
  if (mode === "templates") return list.filter((p) => !p.athleteId && (p.slotCount ?? 0) > 0);
  if (mode === "shared") return list.filter((p) => !p.athleteId);
  if (mode === "client") return value ? all.filter((p) => p.athleteId === value) : list.filter((p) => !!p.athleteId);
  if (mode === "type") return value ? list.filter((p) => p.trainingIntent === value) : list;
  return list;
}

// Newest-updated first.
export function newestFirst<T extends FilterableProgram>(programs: T[]): T[] {
  return programs.slice().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function clientOptions(all: { athleteId: string | null; athleteName: string | null }[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of all) if (p.athleteId && p.athleteName && !seen.has(p.athleteId)) seen.set(p.athleteId, p.athleteName);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function typeOptions(all: FilterableProgram[]): string[] {
  return [...new Set(all.map((p) => p.trainingIntent).filter((t): t is string => !!t))].sort();
}

export function firstName(full: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}
