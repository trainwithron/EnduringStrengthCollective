import type { SupabaseClient } from "@supabase/supabase-js";
import { pickStartGroup, type StartMembership } from "@/lib/start-group";

// "My training": the person's OWN client app, for a coach and for a client alike. There is no group to pick first. Which group opens is decided by this one rule:
//
//   1. The programs that are MINE right now: an active program made for me (athlete_id = me, in any group I belong to, as coach or client), plus an active program a group shares with
//      everyone, in a group where I am a client (never a coach's view of a team program, and never the hidden no-client template of a one-on-one space).
//   2. All of them in ONE group: that group opens, on its Home (today's workout, the program card, Calendar, Nutrition, History).
//   3. In SEVERAL groups: the list is of PROGRAMS (name, and the group in small type), ordered by group name then program name, and the one chosen opens its group.
//   4. None yet: the group the person would land in anyway (a client: where they trained last or joined last; a coach: their last or first team/social group, never a client's own
//      one-on-one space), so a coach can assign themselves a program there and run it. If they belong to no group at all there is nothing to open.
// A coach does not need a "personal space": a program made for the coach (Assign to Myself) lives in the group they coach, and "My training" finds it there.

export interface MyProgramRow {
  programId: string;
  programName: string;
  groupId: string;
  groupName: string;
  // Made for this person, so they can take it off their own list; a program a group shares with everyone is not theirs to remove.
  personal: boolean;
  // Only a coach of the group can change a program (the database allows no other update), so only then is Remove offered.
  canRemove: boolean;
}

export interface MyMembershipRow extends StartMembership {
  group_name: string;
}

export interface MyProgramInput {
  id: string;
  name: string;
  group_id: string;
  athlete_id: string | null;
}

export type MyTrainingResult =
  | { kind: "open"; groupId: string }
  | { kind: "choose"; programs: MyProgramRow[] }
  | { kind: "none" };

// The programs that are mine, from every active program in the groups I belong to.
export function myPrograms(userId: string, memberships: MyMembershipRow[], programs: MyProgramInput[]): MyProgramRow[] {
  const byGroup = new Map(memberships.map((m) => [m.group_id, m]));
  const mine: MyProgramRow[] = [];
  for (const p of programs) {
    const m = byGroup.get(p.group_id);
    if (!m) continue;
    const personal = p.athlete_id === userId;
    const sharedForMe = p.athlete_id === null && m.role === "athlete" && m.group_kind !== "one_on_one";
    if (!personal && !sharedForMe) continue;
    mine.push({ programId: p.id, programName: p.name, groupId: p.group_id, groupName: m.group_name, personal, canRemove: personal && m.role === "coach" });
  }
  return mine.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.programName.localeCompare(b.programName) || a.programId.localeCompare(b.programId));
}

export function resolveMyTraining(
  userId: string,
  memberships: MyMembershipRow[],
  programs: MyProgramInput[],
  start: { lastGroupId?: string | null; recentActivityGroupId?: string | null } = {}
): MyTrainingResult {
  const mine = myPrograms(userId, memberships, programs);
  const groups = new Set(mine.map((p) => p.groupId));
  if (groups.size === 1) return { kind: "open", groupId: mine[0].groupId };
  if (groups.size > 1) return { kind: "choose", programs: mine };
  const landing = pickStartGroup({ memberships, lastGroupId: start.lastGroupId ?? null, recentActivityGroupId: start.recentActivityGroupId ?? null });
  return landing ? { kind: "open", groupId: landing.group_id } : { kind: "none" };
}

// Reads what the rule needs as the signed-in person (they read their own memberships and the programs row security lets them see).
export async function loadMyTraining(supabase: SupabaseClient, userId: string, lastGroupId?: string | null) {
  const [{ data: rows }, { data: recent }] = await Promise.all([
    supabase.from("group_memberships").select("group_id, role, joined_at, groups ( name, group_kind )").eq("profile_id", userId),
    supabase.from("workout_logs").select("group_id").eq("athlete_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const memberships: MyMembershipRow[] = (rows ?? []).map((r) => {
    const g = (r as unknown as { groups: { name: string | null; group_kind: string | null } | { name: string | null; group_kind: string | null }[] | null }).groups;
    const one = Array.isArray(g) ? g[0] : g;
    return {
      group_id: r.group_id as string,
      role: r.role as string,
      joined_at: (r.joined_at as string | null) ?? null,
      group_kind: one?.group_kind ?? null,
      group_name: one?.name ?? "Group",
    };
  });
  const groupIds = memberships.map((m) => m.group_id);
  const { data: programRows } = groupIds.length
    ? await supabase
        .from("programs")
        .select("id, name, group_id, athlete_id")
        .in("group_id", groupIds)
        .eq("is_active", true)
        .is("archived_at", null)
        .eq("org_program", false)
        .or(`athlete_id.is.null,athlete_id.eq.${userId}`)
    : { data: [] };
  const programs = (programRows ?? []) as MyProgramInput[];
  return {
    memberships,
    programs,
    result: resolveMyTraining(userId, memberships, programs, { lastGroupId: lastGroupId ?? null, recentActivityGroupId: (recent?.group_id as string | undefined) ?? null }),
    mine: myPrograms(userId, memberships, programs),
  };
}
