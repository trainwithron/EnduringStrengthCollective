import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { readRowsByIds } from "@/lib/read-by-ids";

// The coach's templates in the organization being worked in, for "Start from a template" on the phone (Spotlight > Program): the same definition as the Templates tab on Programs (a program
// with no client and at least one slot, lib/programs-filter.ts isTemplateProgram), not removed, newest changed first. Used only to USE a template; nothing here builds or edits one.
export interface OrgTemplate {
  id: string;
  name: string;
  groupId: string;
  slotCount: number;
}

export const NO_TEMPLATES_MESSAGE = "No templates yet. On a computer, open a program and choose Make a template.";

/** null when a read failed (said as such, never as "no templates"). */
export async function loadOrgTemplates(supabase: SupabaseClient, coachId: string, groupId: string): Promise<OrgTemplate[] | null> {
  try {
    const groupIds = groupsInOrgOf(await getCoachedGroups(supabase, coachId), groupId).map((g) => g.id);
    if (groupIds.length === 0) return [];
    const [programs, slots] = await Promise.all([
      readRowsByIds(groupIds, (g) => (from, to) =>
        supabase.from("programs").select("id, name, group_id, updated_at").in("group_id", g).is("athlete_id", null).is("archived_at", null).order("id").range(from, to)
      ),
      readRowsByIds(groupIds, (g) => (from, to) =>
        supabase.from("group_workout_exercises").select("id, workouts!inner ( program_id )").eq("is_slot", true).in("group_id", g).order("id").range(from, to)
      ),
    ]);
    if (programs.error || slots.error) return null;
    const slotCount = new Map<string, number>();
    for (const r of slots.data as { workouts?: { program_id?: string } | null }[]) {
      const pid = r.workouts?.program_id;
      if (pid) slotCount.set(pid, (slotCount.get(pid) ?? 0) + 1);
    }
    return (programs.data as { id: string; name: string; group_id: string; updated_at: string | null }[])
      .filter((p) => (slotCount.get(p.id) ?? 0) > 0)
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
      .map((p) => ({ id: p.id, name: p.name, groupId: p.group_id, slotCount: slotCount.get(p.id) ?? 0 }));
  } catch {
    return null;
  }
}
