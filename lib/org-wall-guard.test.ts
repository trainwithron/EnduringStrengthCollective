import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// A guard against the bug Ron found: a coach screen that lists "every group I coach" (all organizations at once) instead of the groups of the organization the coach is in. Any source file that reads the
// signed-in person's own coach memberships directly (group_memberships ... profile_id = me ... role = coach) must either go through lib/coach-groups (getCoachedGroups + groupsInOrgOf) / lib/active-org-groups
// or be on the list below, which holds only code that is about the person's OWN permissions (not what a screen shows) and was reviewed one by one. A new file that does this fails here until someone looks.
const ROOT = join(__dirname, "..");
const REVIEWED_PERMISSION_ONLY = new Set([
  // "is this person a coach at all / do they coach this group" checks, account/erasure/AI-budget plumbing, and server routes that check a caller before acting
  "app/api/ai/coach-conversation/route.ts",
  "app/api/ai/parse-workout/route.ts",
  "app/api/clients/import-roster/undo/route.ts",
  // the team page lists this coach's retired seasons, limited to the organization of the group it is on
  "app/(coach)/groups/[groupId]/team/page.tsx",
  "app/api/credits/low-balance-check/route.ts",
  "app/api/discovery-availability/[coachId]/route.ts",
  "app/api/progress-look/route.ts",
  "app/api/public/discovery-book/route.ts",
  "app/api/share/sign/route.ts",
  "app/api/sms/low-credit-alert/route.ts",
  "lib/account-deletion.ts",
  "lib/ai-budget-server.ts",
  "lib/coach-credits.ts",
  "lib/package-group-access.ts",
  "lib/reference-context.ts",
  "lib/real-coach.ts",
  "lib/user-is-coach.ts",
  "lib/coach-groups.ts",
  // screens whose scope is chosen by their own caller (they take the group ids to use as a prop)
  "components/coach/inactive-clients-panel.tsx",
  "components/coach/expiry-checkin-panel.tsx",
  // reviewed in the organization-wall work: each one either checks the caller against the groups it was given, takes its scope from the organization of the page (the group switcher and Ask Spot filter to it), or is about the person's own permissions
  "app/(coach)/groups/[groupId]/dashboard/page.tsx",
  "app/(coach)/groups/[groupId]/messages/announce/page.tsx",
  "app/api/ai/generate-meal-plan/route.ts",
  "app/api/ai/suggest-patterns/route.ts",
  "app/api/biomech-tags/suggest/route.ts",
  "app/api/broadcast/send/route.ts",
  "app/api/clients/correct-email/route.ts",
  "app/api/coach/api-key/route.ts",
  "app/api/coach/needs-attention/route.ts",
  "app/api/collective-intelligence/chat/route.ts",
  "app/partners/page.tsx",
  "components/coach/desktop/group-switcher.tsx",
  "components/coach/desktop/workspace-menu.tsx",
  "components/coach/mobile/spot-clients-groups-panel.tsx",
  "components/timezone-capture.tsx",
  // checks that the caller coaches a group the client trains in before re-sending that client's guardian request
  "app/api/guardian-consent/resend/route.ts",
  "app/api/guardian-consent/void/route.ts",
  // only decides whether the menus show the selling tools: it asks if the coach has any client of their own in their one-on-one spaces (one row), nothing is listed or shown
  "components/coach/use-coach-type.ts",
  "lib/collective-intelligence-lookups.ts",
  "lib/marketplace-outcome-gather.ts",
  "lib/package-program-access.ts",
  // pickers for moving or adding a person: they list the coach's own groups to choose a destination from; the destination checks (same organization) are in the database (migration 0340)
  "components/coach/add-social-only-membership-control.tsx",
  "components/coach/change-client-group-control.tsx",
  "components/coach/desktop/add-client-button.tsx",
  // coach-level pages that read the groups of the organization they stand on in the lines that follow (checked by the other tests in this file)
  "app/(coach)/dashboard/page.tsx",
  "app/(coach)/groups/[groupId]/athletes/[athleteId]/view/page.tsx",
  "app/(coach)/groups/[groupId]/business/session-types/page.tsx",
  "app/(coach)/groups/[groupId]/goal/page.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("no screen reads every group a coach coaches (all organizations at once)", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      const direct = /from\("group_memberships"\)[\s\S]{0,300}?\.eq\("profile_id", (?:me|user\.id|coachId|userId)\)[\s\S]{0,60}?\.eq\("role", "coach"\)/.test(src);
      if (direct && !REVIEWED_PERMISSION_ONLY.has(rel)) offenders.push(rel);
    }
  }
  it("every direct read of the coach's own coach memberships is on the reviewed list", () => {
    expect(offenders).toEqual([]);
  });
});

describe("the coach-level pages and pickers stand on the organization the coach chose", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  it("Programs, Calendar, Clients and Group calendar use the active organization's group, not the first group by name", () => {
    for (const f of ["app/(coach)/programs/page.tsx", "app/(coach)/calendar/page.tsx", "app/(coach)/clients/page.tsx", "app/(coach)/group-calendar/page.tsx"]) {
      const src = read(f);
      expect(src).toContain("getActiveAnchor(supabase, user.id)");
      expect(src).not.toContain("pickCoachAnchor(");
    }
  });
  it("the finder, the workspace picker and the Business widget read only the organization's groups", () => {
    for (const f of ["components/coach/desktop/client-finder.tsx", "components/coach/workspace/pane-picker.tsx", "components/coach/desktop/rail-widgets/business-rail-widget.tsx"]) {
      expect(read(f)).toContain("activeOrgGroupsFor(");
    }
  });
  it("the Business page, MRR, the calendar's sessions and the assignable clients are one organization's", () => {
    expect(read("app/(coach)/groups/[groupId]/business/page.tsx")).toContain("loadBusinessScope(supabase, user.id, params.groupId)");
    expect(read("lib/business-scope.ts")).toContain("groupsInOrgOf(await getCoachedGroups(supabase, userId, true), groupId)");
    expect(read("lib/coach-mrr.ts")).toContain("loadBusinessScope(supabase, coachId, groupId)");
    expect(read("lib/assign-clients.ts")).toContain("(await groupsInOrgOfOpened(supabase, coachId, programGroupId))");
    const cal = read("components/coach/calendar-page-body.tsx");
    // every read of the coach's bookings and sessions on the calendar goes by the organization's groups (in groups of ids: lib/read-by-ids.ts)
    expect((cal.match(/readRowsByIds\(\s*orgGroupIds|readByIds\(\s*orgGroupIds/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("visiting a group of the chosen organization remembers it as the workspace (the middleware alone, FIX 4), and the theme follows the chosen organization, then the workspace", () => {
    expect(read("components/coach/coach-desktop-shell.tsx")).not.toContain("LAST_WORKSPACE_GROUP_COOKIE");
    expect(read("lib/supabase/middleware.ts")).toContain("response.cookies.set(LAST_WORKSPACE_GROUP_COOKIE");
    const theme = read("lib/org-theme-server.ts");
    // the remembered workspace is read once per request for the colors and the team words together (lib/workspace-group-row.ts)
    expect(theme).toContain("(await getWorkspaceGroupRow()).row?.organization_id");
    expect(read("lib/workspace-group-row.ts")).toContain("get(LAST_WORKSPACE_GROUP_COOKIE)");
    expect(theme.indexOf("ACTIVE_ORG_COOKIE_NAME)?.value")).toBeLessThan(theme.indexOf("getWorkspaceGroupRow()).row"));
  });
});

describe("Ask Spot, the group switcher, the group dashboard and the View-as-Client picker stay in one organization", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  it("Ask Spot's roster, name matching and weekly count use only the active organization's groups", () => {
    const route = read("app/api/collective-intelligence/chat/route.ts");
    expect(route).toContain("getActiveAnchor(supabase, user.id)");
    expect(route).toContain("scopeGroupIds: orgGroupIds");
    expect(route).toContain("getRosterLoggingThisWeek(supabase, user.id, orgGroupIds)");
    expect(route).toContain("getRosterFullNames(supabase, user.id, orgGroupIds)");
    expect(read("lib/collective-intelligence-lookups.ts")).toContain("filter((id) => !scopeGroupIds || scopeGroupIds.includes(id))");
  });
  it("the group switcher lists only the open organization's groups; the picker lists only its clients", () => {
    expect(read("components/coach/desktop/group-switcher.tsx")).toContain("g.organization_id === currentOrgId");
    expect(read("components/athlete/view-as-client-picker.tsx")).toContain("activeOrgGroupsFor(supabase, user.id, null)");
  });
  it("the group dashboard's all-groups view means the organization's groups", () => {
    expect(read("app/(coach)/groups/[groupId]/dashboard/page.tsx")).toContain("orgGroupIdSet.has(id)");
  });
});

describe("the organization walls in the database (migration 0345)", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/0345_organization_walls.sql"), "utf8").replace(/\r\n/g, "\n");
  it("profiles are no longer open to every signed-in account", () => {
    expect(sql).toContain('drop policy if exists "profiles_select_authenticated" on public.profiles;');
    expect(sql).toContain("using (public.can_see_profile(id))");
  });
  it("no policy lets a platform administrator read client content", () => {
    const afterTop = sql.split("-- 2. No platform-admin read of client content.")[1].split("-- 3. Who has which tag")[0];
    expect(afterTop).not.toContain("is_platform_admin");
  });
});

describe("assistant, bell, notifications page and digest stay in one organization", () => {
  const read2 = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  it("the assistant's client and program search is the open organization's", () => {
    const route = read2("app/api/assistant/navigate/route.ts");
    expect(route).toContain("getActiveAnchor(supabase, user.id)");
    expect(route).toContain("const coachGroupIds = orgGroupIdSet");
  });
  it("the coach's bell and notifications page list only the open organization's notifications", () => {
    const bell = read2("components/athlete/notification-bell.tsx");
    expect(bell).toContain("group_id.is.null,group_id.in.");
    expect(bell).toContain("if (scopeIds && n.group_id && !scopeIds.includes(n.group_id)) return;");
    expect(read2("components/coach/coach-desktop-shell.tsx")).toContain("<HeaderNotificationBell scopeGroupId={groupId} />");
    const page = read2("app/notifications/page.tsx");
    expect(page).toContain("!n.group_id || orgGroupIds.has(n.group_id)");
  });
  it("the daily digest is one push per coach PER organization, labeled when the coach runs several", () => {
    const digest = read2("app/api/cron/coach-digest/route.ts");
    expect(digest).toContain("`${row.profile_id}|${g?.organization_id ?? \"none\"}`");
    expect(digest).toContain("since you last checked");
    expect(digest).toContain("orgCountByCoach");
  });
});

describe("the daily briefing is made per organization", () => {
  const read3 = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  it("the briefing cron builds one briefing per coach per organization, from that organization's clients only", () => {
    const cron = read3("app/api/cron/coach-briefing/route.ts");
    expect(cron).toContain("groupIdsByCoachOrg");
    expect(cron).toContain("organization_id: organizationId");
    expect(cron).toContain("gatherCandidateSignals(supabase, { coachId, groupIds, timeZone })");
  });
  it("Home shows only the open organization's briefing items", () => {
    const home = read3("app/(coach)/dashboard/page.tsx");
    expect(home).toContain("collectiveIntelligenceItems.filter((i) => !i.groupId || allGroupIds.includes(i.groupId))");
  });
});
