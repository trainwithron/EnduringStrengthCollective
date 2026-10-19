import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/coach-groups";
import { readRowsByIds } from "@/lib/read-by-ids";
import { coachPhoneLanding, teamOnlyOrgs } from "@/lib/coach-landing";
import { COACH_PHONE_LANDING } from "@/lib/start-group";

// Where a coach on a phone goes after signing in (lib/coach-landing.ts): the coach home of a team organization, the one-screen organization chooser when they have several and have not chosen, or their own client app
// as before. Read-only: it only decides and redirects.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL("/login", url));

  let target = COACH_PHONE_LANDING;
  try {
    const groups = await getCoachedGroups(supabase, user.id);
    const raw = (await cookies()).get(LAST_WORKSPACE_GROUP_COOKIE)?.value;
    let remembered: string | null = null;
    try {
      remembered = raw ? decodeURIComponent(raw) : null;
    } catch {
      remembered = raw ?? null;
    }
    const modes = await readRowsByIds(groups.map((g) => g.id), (ids) => (from, to) => supabase.from("groups").select("id, team_mode").in("id", ids).order("id").range(from, to));
    // a failed read leaves the landing as it was: their own client app
    if (!modes.error) {
      const teamModeByGroup = new Map((modes.data as { id: string; team_mode: boolean | null }[]).map((r) => [r.id, r.team_mode]));
      const landing = coachPhoneLanding(groups, remembered, teamOnlyOrgs(groups, teamModeByGroup));
      if (landing.to === "choose") target = "/choose-organization?next=/coach-landing";
      else if (landing.to === "coach-home") target = `/groups/${landing.groupId}`;
    }
  } catch {
    target = COACH_PHONE_LANDING;
  }
  return NextResponse.redirect(new URL(target, url));
}
