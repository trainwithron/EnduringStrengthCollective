import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/coach-groups";
import { ACTIVE_ORG_COOKIE, decodeCookieValue, rememberedGroupForActiveOrg } from "@/lib/active-org";
import { readRowsByIds } from "@/lib/read-by-ids";
import { coachPhoneLanding, teamOnlyOrgs } from "@/lib/coach-landing";
import { COACH_PHONE_ENTRY_KEEP_ORG, COACH_PHONE_LANDING } from "@/lib/start-group";
import { openOwnSpaceRedirect } from "@/lib/open-own-space";
import { readHomeOrgId, setActiveOrgCookies } from "@/lib/home-org";

// Where a coach on a phone goes (lib/coach-landing.ts): the coach home of a team organization, the one-screen organization chooser when they have several and none is chosen, or their own client app.
// A fresh open of the app (signing in, the app's icon) starts in the coach's HOME organization (lib/home-org.ts) and remembers it, so the choice follows the organization: a team organization opens its team
// Home. Home on the phone while working (/dashboard, which opens /coach-landing/keep-org: this same logic with ?keep=org) keeps the organization chosen in Spotlight instead.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL("/login", url));
  const keepOrg = url.searchParams.get("keep") === "org";

  let target = COACH_PHONE_LANDING;
  let startIn: { orgId: string; groupId: string } | null = null;
  try {
    const groups = await getCoachedGroups(supabase, user.id);
    const jar = await cookies();
    const orgIds = [...new Set(groups.map((g) => g.orgId))];
    const [modes, homeOrg] = await Promise.all([
      readRowsByIds(groups.map((g) => g.id), (ids) => (from, to) => supabase.from("groups").select("id, team_mode").in("id", ids).order("id").range(from, to)),
      keepOrg ? Promise.resolve(null) : readHomeOrgId(supabase, user.id, orgIds),
    ]);
    // A failed read of the memberships keeps the organization already chosen.
    const activeOrg = homeOrg ?? decodeCookieValue(jar.get(ACTIVE_ORG_COOKIE)?.value);
    const remembered = rememberedGroupForActiveOrg(groups, activeOrg, decodeCookieValue(jar.get(LAST_WORKSPACE_GROUP_COOKIE)?.value));
    if (homeOrg && remembered) startIn = { orgId: homeOrg, groupId: remembered };
    // a failed read leaves the landing as it was: their own client app
    if (!modes.error) {
      const teamModeByGroup = new Map((modes.data as { id: string; team_mode: boolean | null }[]).map((r) => [r.id, r.team_mode]));
      const landing = coachPhoneLanding(groups, remembered, teamOnlyOrgs(groups, teamModeByGroup));
      if (landing.to === "choose") target = `/choose-organization?next=${encodeURIComponent(COACH_PHONE_ENTRY_KEEP_ORG)}`;
      else if (landing.to === "coach-home") target = `/groups/${landing.groupId}`;
    }
  } catch {
    target = COACH_PHONE_LANDING;
  }
  // Their own client app: straight there in this one response (it used to bounce through /my-space first). Anything unexpected falls back to that hop.
  const response =
    target === COACH_PHONE_LANDING
      ? (await openOwnSpaceRedirect(user, url, new URLSearchParams({ view: "client" }))) ?? NextResponse.redirect(new URL(COACH_PHONE_LANDING, url))
      : NextResponse.redirect(new URL(target, url));
  if (startIn && response.status >= 300 && response.status < 400) setActiveOrgCookies(response, startIn.orgId, startIn.groupId);
  return response;
}
