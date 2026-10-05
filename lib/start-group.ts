import type { SupabaseClient } from "@supabase/supabase-js";

// One rule for where a person lands, used by login, "/", set-password and the coach phone redirect, so the same
// person gets the same start point every time instead of whichever membership row the database happened to return
// first.
//   Coach: the last place they worked if it is one of their groups, else their first group that is not a client's own
//          one-on-one group (earliest joined, so it never changes between logins); only if every group they coach is a
//          one-on-one group do they land in one of those.
//   Athlete: the group they were last active in, else the last place they were, else the group they joined most recently.
export interface StartMembership {
  group_id: string;
  role: string;
  joined_at: string | null;
  group_kind: string | null;
}

export interface StartInputs {
  memberships: StartMembership[];
  lastGroupId?: string | null;
  recentActivityGroupId?: string | null;
}

function byJoined(a: StartMembership, b: StartMembership): number {
  const aj = a.joined_at ?? "";
  const bj = b.joined_at ?? "";
  if (aj !== bj) return aj < bj ? -1 : 1;
  return a.group_id < b.group_id ? -1 : a.group_id > b.group_id ? 1 : 0;
}

export function pickStartGroup({ memberships, lastGroupId, recentActivityGroupId }: StartInputs): StartMembership | null {
  if (memberships.length === 0) return null;
  const coachGroups = memberships.filter((m) => m.role === "coach");

  if (coachGroups.length > 0) {
    const shared = coachGroups.filter((m) => m.group_kind !== "one_on_one").sort(byJoined);
    const last = lastGroupId ? shared.find((m) => m.group_id === lastGroupId) : undefined;
    if (last) return last;
    if (shared.length > 0) return shared[0];
    const lastSolo = lastGroupId ? coachGroups.find((m) => m.group_id === lastGroupId) : undefined;
    return lastSolo ?? [...coachGroups].sort(byJoined)[0];
  }

  const recent = recentActivityGroupId ? memberships.find((m) => m.group_id === recentActivityGroupId) : undefined;
  if (recent) return recent;
  const last = lastGroupId ? memberships.find((m) => m.group_id === lastGroupId) : undefined;
  if (last) return last;
  return [...memberships].sort((a, b) => -byJoined(a, b))[0];
}

// Reads what the rule needs. Works with the browser or the server client (the person reads their own rows).
export async function loadStartInputs(
  supabase: SupabaseClient,
  userId: string,
  lastGroupId?: string | null
): Promise<StartInputs> {
  const [{ data: rows }, { data: recent }] = await Promise.all([
    supabase.from("group_memberships").select("group_id, role, joined_at, groups ( group_kind )").eq("profile_id", userId),
    supabase
      .from("workout_logs")
      .select("group_id")
      .eq("athlete_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const memberships: StartMembership[] = (rows ?? []).map((r) => {
    const g = (r as unknown as { groups: { group_kind: string | null } | { group_kind: string | null }[] | null }).groups;
    const kind = Array.isArray(g) ? g[0]?.group_kind ?? null : g?.group_kind ?? null;
    return {
      group_id: r.group_id as string,
      role: r.role as string,
      joined_at: (r.joined_at as string | null) ?? null,
      group_kind: kind,
    };
  });
  return { memberships, lastGroupId: lastGroupId ?? null, recentActivityGroupId: (recent?.group_id as string | undefined) ?? null };
}

// The "last_group" cookie the app already sets when a coach works in a group: {"id": "..."}.
export function parseLastGroupCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return typeof parsed?.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}
