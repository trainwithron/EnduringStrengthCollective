// The list a coach picks from when assigning a program to a client: every program they made, the ones used most as templates first (most copies made from them), then the newest.
// An unsigned AI draft can be picked: the coach's click on Assign is the approval (it is signed off, then assigned). Pure; no database.

export interface PickableProgram {
  id: string;
  name: string;
  createdAt: string;
  aiDraft: boolean;
  // The client this program was made for, or null for a shared / template program.
  clientName: string | null;
  // The program this one was copied from (programs.source_program_id), if any.
  sourceProgramId: string | null;
  // "one_on_one" for a program in a client's own space: with no client on it, it is a template that belongs to nobody yet.
  groupKind?: string | null;
}

export function orderForAssign(programs: PickableProgram[]): (PickableProgram & { uses: number })[] {
  const uses = new Map<string, number>();
  for (const p of programs) if (p.sourceProgramId) uses.set(p.sourceProgramId, (uses.get(p.sourceProgramId) ?? 0) + 1);
  return programs
    .map((p) => ({ ...p, uses: uses.get(p.id) ?? 0 }))
    .sort((a, b) => b.uses - a.uses || b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

export function filterPrograms<T extends { name: string; clientName: string | null }>(programs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return programs;
  return programs.filter((p) => p.name.toLowerCase().includes(q) || (p.clientName ?? "").toLowerCase().includes(q));
}

// The little label under a program's name.
export function programLabel(p: { aiDraft: boolean; clientName: string | null; uses: number; groupKind?: string | null }): string {
  if (p.aiDraft) return "AI draft: signed off when you assign";
  const base = p.clientName ? `${p.clientName}'s copy` : p.groupKind === "one_on_one" ? "Not assigned to anyone" : "Shared";
  return p.uses > 0 ? `${base} · used ${p.uses} ${p.uses === 1 ? "time" : "times"}` : base;
}

// A search box is only worth showing when the list is long.
export const SEARCH_FROM = 8;
