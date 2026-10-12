import type { SupabaseClient } from "@supabase/supabase-js";

// "Assigned to": each person who has their own independent version (instance) of a library program. An instance is a program row made for one person whose source_program_id is the library
// program. It is the person's own: own progress, own edits, no overlap with anyone else's.

export interface AssignedInstance {
  instanceId: string;
  athleteId: string;
  athleteName: string;
  groupId: string;
  startDate: string | null;
}

export async function loadAssignedTo(supabase: SupabaseClient, programId: string): Promise<AssignedInstance[]> {
  const { data } = await supabase
    .from("programs")
    .select("id, athlete_id, group_id, start_date, profiles!programs_athlete_id_fkey ( full_name )")
    .eq("source_program_id", programId)
    .is("archived_at", null)
    .not("athlete_id", "is", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as any[]).map((r) => ({
    instanceId: r.id as string,
    athleteId: r.athlete_id as string,
    athleteName: ((r.profiles?.full_name as string | null) ?? "Unknown").trim() || "Unknown",
    groupId: r.group_id as string,
    startDate: (r.start_date as string | null) ?? null,
  }));
}

// How many people each library program is assigned to (not removed), for the count on its card.
export async function countAssignedTo(supabase: SupabaseClient, programIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (programIds.length === 0) return out;
  const { data } = await supabase.from("programs").select("source_program_id").in("source_program_id", programIds).is("archived_at", null).not("athlete_id", "is", null);
  for (const r of (data ?? []) as { source_program_id: string }[]) out.set(r.source_program_id, (out.get(r.source_program_id) ?? 0) + 1);
  return out;
}

export function assignedBlockMessage(count: number): string {
  return `This program is assigned to ${count} ${count === 1 ? "person" : "people"}. Remove it from them first, or hide it instead.`;
}
