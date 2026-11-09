import type { SupabaseClient } from "@supabase/supabase-js";
import { isMinorDob } from "@/lib/youth-block";

// A one-on-one client is OFFERED their organization's shared group (Ron, Nov 9): never added automatically. The card on their Home, the join route and Settings all use this file, so who is offered
// what can never drift between them. Joining makes a social-only athlete seat in that group (feed, chat, PR board, leaderboard; no booking or packages there, migration 0125) with the client's own
// choice of whether their finished workouts are also posted there (group_memberships.shares_workouts, step 202).

export interface SharedGroupCandidate {
  id: string;
  name: string;
  group_kind: string | null;
  team_mode: boolean | null;
  archived_at: string | null;
}

// The organization's shared group: a team or social group that is not a team-sport roster and not retired. Exactly one is offered; with none or several nothing is (which one would be a guess).
export function isOfferableSharedGroup(g: SharedGroupCandidate): boolean {
  return (g.group_kind === "team" || g.group_kind === "social") && !g.team_mode && !g.archived_at;
}

export function pickSharedGroup(groups: SharedGroupCandidate[]): SharedGroupCandidate | null {
  const offerable = groups.filter(isOfferableSharedGroup);
  return offerable.length === 1 ? offerable[0] : null;
}

// "Coach Ron": the first word of the coach's name. Without a name, "your coach".
export function coachLabel(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? `Coach ${first}` : "your coach";
}

// Under 18 by the date of birth on the client's health form: only the private join is offered, and sharing cannot be switched on (there is no coach switch that allows it).
// A client with no date on file is treated as an adult here, as everywhere else that decides "under 18" (lib/youth-block.ts isMinorDob).
export function canShareWorkouts(dateOfBirth: string | null | undefined, asOf: Date = new Date()): boolean {
  return !isMinorDob(dateOfBirth, asOf);
}

export interface SharedGroupOffer {
  groupId: string;
  groupName: string;
  coachName: string;
  allowShare: boolean;
}

// Whether the database has the sharing choice yet (step 202). Until it does, nothing is offered and nobody can join this way.
export async function sharingColumnReady(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("group_memberships").select("shares_workouts").limit(1);
  return !error;
}

async function isMinorClient(db: SupabaseClient, athleteId: string): Promise<boolean> {
  const { data, error } = await db.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle();
  // a failed read is treated as under 18: the private join is still offered
  if (error) return true;
  return !canShareWorkouts((data as { date_of_birth?: string | null } | null)?.date_of_birth);
}

// What this client is offered from this one-on-one space, or null. Read with the service role (the client cannot read a group they are not in); the caller has already confirmed who the
// signed-in person is. Null when: the space is not a one-on-one space of an organization, the person is not the client in it, the organization has no single shared group, they are already in
// that group, or the database is not ready.
export async function loadSharedGroupOffer(db: SupabaseClient, athleteId: string, spaceGroupId: string): Promise<SharedGroupOffer | null> {
  if (!athleteId || !spaceGroupId) return null;
  const [{ data: space }, { data: seat }] = await Promise.all([
    db.from("groups").select("id, organization_id, group_kind, archived_at").eq("id", spaceGroupId).maybeSingle(),
    db.from("group_memberships").select("role").eq("group_id", spaceGroupId).eq("profile_id", athleteId).maybeSingle(),
  ]);
  const s = space as { organization_id: string | null; group_kind: string | null; archived_at: string | null } | null;
  if (!s || s.group_kind !== "one_on_one" || !s.organization_id || s.archived_at) return null;
  if ((seat as { role?: string } | null)?.role !== "athlete") return null;

  const { data: orgGroups, error: groupsError } = await db.from("groups").select("id, name, group_kind, team_mode, archived_at").eq("organization_id", s.organization_id);
  if (groupsError) return null;
  const shared = pickSharedGroup((orgGroups ?? []) as SharedGroupCandidate[]);
  if (!shared) return null;

  const [{ data: already, error: alreadyError }, ready, { data: coachRow }] = await Promise.all([
    db.from("group_memberships").select("id").eq("group_id", shared.id).eq("profile_id", athleteId).maybeSingle(),
    sharingColumnReady(db),
    db.from("group_memberships").select("profiles ( full_name )").eq("group_id", spaceGroupId).eq("role", "coach").order("joined_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (alreadyError || already || !ready) return null;

  const coachProfile = (coachRow as { profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null } | null)?.profiles;
  const coachName = coachLabel(Array.isArray(coachProfile) ? coachProfile[0]?.full_name : coachProfile?.full_name);
  return { groupId: shared.id, groupName: shared.name, coachName, allowShare: !(await isMinorClient(db, athleteId)) };
}

// The client's own social-only seats in shared groups, for Settings. Empty before step 202.
export interface MySharedGroup {
  groupId: string;
  groupName: string;
  sharesWorkouts: boolean;
  allowShare: boolean;
}

export async function loadMySharedGroups(db: SupabaseClient, athleteId: string, organizationId: string | null): Promise<MySharedGroup[]> {
  if (!athleteId || !organizationId) return [];
  const { data, error } = await db
    .from("group_memberships")
    .select("group_id, shares_workouts, groups!inner ( name, organization_id )")
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .eq("membership_type", "social_only")
    .eq("groups.organization_id", organizationId);
  if (error || !data || data.length === 0) return [];
  const allowShare = !(await isMinorClient(db, athleteId));
  return (data as any[]).map((r) => {
    const g = Array.isArray(r.groups) ? r.groups[0] : r.groups;
    return { groupId: r.group_id as string, groupName: (g?.name as string | undefined) ?? "the group", sharesWorkouts: !!r.shares_workouts, allowShare };
  });
}

// The shared group whose feed a one-on-one client reads from their own space (their Feed tab): a group of the same organization they hold a social-only seat in. Null when there is none.
// Read as the signed-in person (their own seats).
export async function sharedFeedGroupFor(supabase: SupabaseClient, athleteId: string, organizationId: string | null): Promise<string | null> {
  if (!athleteId || !organizationId) return null;
  const { data, error } = await supabase
    .from("group_memberships")
    .select("group_id, groups!inner ( name, organization_id, group_kind, archived_at )")
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .eq("membership_type", "social_only")
    .eq("groups.organization_id", organizationId);
  if (error || !data) return null;
  const choices = (data as any[])
    .map((r) => ({ id: r.group_id as string, g: Array.isArray(r.groups) ? r.groups[0] : r.groups }))
    .filter((r) => r.g && r.g.group_kind !== "one_on_one" && !r.g.archived_at)
    .sort((a, b) => String(a.g.name ?? "").localeCompare(String(b.g.name ?? "")));
  return choices[0]?.id ?? null;
}

// Taking a client's workout cards off a shared group's feed (they turned sharing off, or left): the cards of workouts from their own space, never anything they wrote by hand in the group, and never a
// workout they logged in that group itself.
export async function removeSharedWorkoutCards(db: SupabaseClient, groupId: string, athleteId: string): Promise<boolean> {
  const { data, error } = await db.from("posts").select("id, workout_logs ( group_id )").eq("group_id", groupId).eq("author_id", athleteId).eq("post_type", "workout_summary");
  if (error) return false;
  const ids = ((data ?? []) as any[])
    .filter((p) => {
      const log = Array.isArray(p.workout_logs) ? p.workout_logs[0] : p.workout_logs;
      return !log || log.group_id !== groupId;
    })
    .map((p) => p.id as string);
  if (ids.length === 0) return true;
  const { error: deleteError } = await db.from("posts").delete().in("id", ids);
  return !deleteError;
}
