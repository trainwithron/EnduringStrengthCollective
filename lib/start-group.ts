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

// Which group's feed a coach looks at from their own client app: the one the address names if it is one of their shared (team or social) groups, else the group they were last working in if it is shared, else the
// first by name. A client's own one-on-one space has no feed, and neither has the coach's personal space, so only shared groups are offered.
export function pickFeedGroup<T extends { id: string; name: string }>(sharedGroups: T[], requested: string | null | undefined, remembered: string | null | undefined): T | null {
  if (sharedGroups.length === 0) return null;
  const sorted = [...sharedGroups].sort((a, b) => a.name.localeCompare(b.name));
  return sorted.find((g) => g.id === requested) ?? sorted.find((g) => g.id === remembered) ?? sorted[0];
}

// Where a person lands once the group is known. A coach at a computer lands on the desktop Home; a coach on a phone (or the installed app) lands on their OWN client profile, the same app a client has, with the
// Spot button for the business side and a picker to look at any client (Ron, Oct 16: "I open my app and it's a client profile but it's my profile"). Everyone else lands in their group's page.
// A coach on a phone arrives at the landing decision (app/coach-landing/route.ts, lib/coach-landing.ts): the coach home of a team organization, the organization chooser, or their own client app (COACH_PHONE_LANDING).
export const COACH_PHONE_ENTRY = "/coach-landing";
// Home on the phone while working (the computer's Home address, the chooser's way back): the same decision, in the organization already chosen (a fresh open starts in the home organization, lib/home-org.ts).
export const COACH_PHONE_ENTRY_KEEP_ORG = "/coach-landing/keep-org"; // its own path (app/coach-landing/keep-org/route.ts), not ?keep=org
export const COACH_PHONE_LANDING = "/my-space/home";
// Where "Home" goes from a coach tool (the Coach mode bar while logging for a client, finishing that workout): the coaching Home. At a computer that is the dashboard; on a phone /dashboard makes the landing decision above. Never a group page: a client's one-on-one space would be titled with the client's name (Release 2, the "SAWYER STEELE" fix).
export const COACH_HOME_HREF = "/dashboard";
export function startPath(membership: Pick<StartMembership, "group_id" | "role"> | null, onPhone: boolean): string {
  if (!membership) return "/";
  if (membership.role !== "coach") return `/groups/${membership.group_id}`;
  return onPhone ? COACH_PHONE_ENTRY : "/dashboard";
}

// Reads what the rule needs. Works with the browser or the server client (the person reads their own rows).
export async function loadStartInputs(
  supabase: SupabaseClient,
  userId: string,
  lastGroupId?: string | null
): Promise<StartInputs> {
  const read = (columns: string) => (supabase as any).from("group_memberships").select(`group_id, role, joined_at, groups ( ${columns} )`).eq("profile_id", userId) as PromiseLike<{ data: any[] | null; error: unknown }>;
  // A retired group (a past season) is not where anyone lands. A database without that column yet is read as before.
  let first = await read("group_kind, archived_at");
  if (first.error) first = await read("group_kind");
  const [{ data: rows }, { data: recent }] = await Promise.all([
    Promise.resolve(first),
    supabase
      .from("workout_logs")
      .select("group_id")
      .eq("athlete_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  type G = { group_kind: string | null; archived_at?: string | null };
  const all = (rows ?? []).map((r) => {
    const g = (r as unknown as { groups: G | G[] | null }).groups;
    const one = Array.isArray(g) ? g[0] : g;
    return {
      archived: !!one?.archived_at,
      membership: {
        group_id: r.group_id as string,
        role: r.role as string,
        joined_at: (r.joined_at as string | null) ?? null,
        group_kind: one?.group_kind ?? null,
      } as StartMembership,
    };
  });
  // Past seasons are left out, but only where the person has another live membership in the same role (a coach whose only coached groups were retired is still a coach, and does not become a client because of an athlete seat elsewhere).
  const liveRoles = new Set(all.filter((a) => !a.archived).map((a) => a.membership.role === "coach" ? "coach" : "other"));
  const memberships: StartMembership[] = all.filter((a) => !a.archived || !liveRoles.has(a.membership.role === "coach" ? "coach" : "other")).map((a) => a.membership);
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
