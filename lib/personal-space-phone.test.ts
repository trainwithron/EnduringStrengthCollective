import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Live bug (Ron's phone): the "act as yourself" setting is a 12 hour cookie. When it ran out while his own training space was still open, the phone showed the coaching Home of that empty space
// ("Welcome. Two things get you started") instead of his own training. A coach's own personal space is now always his client app, as himself, with or without the cookie.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const acting = read("lib/acting-as.ts");

describe("a coach's own personal space on the phone", () => {
  it("always resolves as himself, without the 12 hour cookie", () => {
    expect(acting).toContain("isOwnPersonalSpace(groupId, realUserId)");
    expect(acting).toContain("organization_id === null");
    expect(acting).toContain("created_by === userId");
    expect(acting).toContain("return { athleteId: realUserId, realUserId, isActingAsOther: true }");
  });
});

describe("Release 2: the phone opens as the coach's own account", () => {
  it("a coach on a phone never gets a 'coach Home' for a group: a team-sport group keeps its team Home, any other group opens their own app", () => {
    const page = read("app/(coach)/groups/[groupId]/page.tsx");
    expect(page).toContain("if (isTeamSportGroup((teamRow as { team_mode?: boolean | null } | null)?.team_mode)) return <TeamCoachPhoneHome groupId={params.groupId} groupName={group.name} />;");
    expect(page).toContain("redirect(COACH_PHONE_LANDING);");
    expect(page).not.toContain("CoachMobileHome");
  });
  it("the bar on every coach page is their own app's five tabs (no coach bar, no More)", () => {
    const bar = read("components/athlete/bottom-tab-bar.tsx");
    expect(bar).not.toContain('variant === "coach"');
    expect(bar).not.toContain('label: "More"');
    for (const tab of ['mySpaceHref("calendar")', 'mySpaceHref("feed")', 'mySpaceHref("nutrition")', 'mySpaceHref("settings")', "homeHref ?? mySpaceHref(null)"]) expect(bar).toContain(tab);
    expect(read("components/coach/mobile/coach-mobile-shell.tsx")).toContain('<BottomTabBar groupId={groupId} variant="own" activeOverride={activeOverride} homeHref={homeHref} />');
    expect(read("components/coach/coach-desktop-shell.tsx")).toContain('<BottomTabBar groupId={groupId} variant="own" activeOverride={null} />');
  });
  it("says who is being logged for on the coach-logs-for-a-client bar", () => {
    const bar = read("components/coach/mobile/coach-mode-bar.tsx");
    expect(bar).toContain("Logging for {clientName}");
  });
});

