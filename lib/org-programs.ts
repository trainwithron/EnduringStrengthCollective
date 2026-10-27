import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf, type CoachedGroup } from "@/lib/coach-groups";
import { duplicateProgram } from "@/lib/program-duplication";

// Organization programs (migration 0435; Ron, Oct 26: "i want programs tied to the org and assignable to client and group in the org", "groups are different than clients. clients can go
// in groups but not the other way around"). An organization program (programs.org_program) is the organization's own: it is never followed by anyone and is only copied out, to a client (their own
// copy) or to a group (the copy is that group's program, which every member follows, with the group's feed and team sheet). It lives in the organization's anchor group only as a technical home, so
// its pages never show that group's name.

// What the top of a program's page says it belongs to: the organization's programs, a client, or the group.
export function programPlace(input: { orgProgram: boolean; athleteName: string | null; groupName: string }): string {
  if (input.orgProgram) return "Programs";
  return input.athleteName ?? input.groupName;
}

// A program made from the program library (or for a client from their page, which lives with the coach's other programs) is the organization's; one made from a group's own page is that group's.
export function newProgramIsOrgProgram(input: { athleteId: string | null; fromLibrary: boolean }): boolean {
  return input.athleteId === null && input.fromLibrary;
}

export interface AssignableGroup {
  id: string;
  name: string;
}

// The groups an organization program can go to: the team and social groups of the same organization (never a client's one-on-one space, never another organization, never a retired season).
export async function loadAssignableGroups(supabase: SupabaseClient, coachId: string, programGroupId: string): Promise<AssignableGroup[]> {
  return assignableGroupsFrom(await getCoachedGroups(supabase, coachId), programGroupId);
}

export function assignableGroupsFrom(coached: CoachedGroup[], programGroupId: string): AssignableGroup[] {
  return groupsInOrgOf(coached, programGroupId)
    .filter((g) => (g.kind === "team" || g.kind === "social") && !g.archived)
    .map((g) => ({ id: g.id, name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The groups that already have their own copy of this program. A library Duplicate or a template made from it is an organization program in the anchor group, not a group's copy, so it
// never counts (it would otherwise block assigning to that team).
export async function loadAssignedGroups(supabase: SupabaseClient, programId: string): Promise<{ programId: string; groupId: string; groupName: string }[]> {
  const { data } = await supabase.from("programs").select("id, group_id, groups ( name )").eq("source_program_id", programId).is("athlete_id", null).is("archived_at", null).eq("org_program", false);
  return ((data ?? []) as { id: string; group_id: string; groups?: { name?: string | null } | null }[]).map((r) => ({ programId: r.id, groupId: r.group_id, groupName: r.groups?.name ?? "Group" }));
}

// Assigning to a group: the group gets its own copy, switched on, which its members follow (it is that group's program, not an organization program).
export async function assignProgramToGroup(
  supabase: SupabaseClient,
  { sourceProgramId, groupId, createdBy, startDate }: { sourceProgramId: string; groupId: string; createdBy: string; startDate?: string }
): Promise<{ programId: string } | { error: string }> {
  const copy = await duplicateProgram(supabase, { sourceProgramId, destinationGroupId: groupId, createdBy, startDate });
  if ("error" in copy) return copy;
  const { error } = await supabase.from("programs").update({ is_active: true, org_program: false }).eq("id", copy.programId);
  if (error) return { error: "The group got its copy, but it could not be switched on. Open it and switch it on." };
  return copy;
}

// "Duplicate" inside the same library: the copy of an organization program is an organization program too (a plain copy would otherwise become the anchor group's own program).
export async function keepOrgProgramMark(supabase: SupabaseClient, sourceProgramId: string, copyId: string): Promise<void> {
  const { data } = await supabase.from("programs").select("org_program").eq("id", sourceProgramId).maybeSingle();
  if ((data as { org_program?: boolean | null } | null)?.org_program === true) await supabase.from("programs").update({ org_program: true }).eq("id", copyId);
}
