import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTeamSportGroup, teamSportMenu, teamSportMoreMenu, TEAM_SPORT_HIDDEN_HUB_TILES, TEAM_SPORT_BUSINESS_LABEL, teamSportBusinessHref, withTeamSportWords } from "@/lib/team-sport";
import { resolveTerm } from "@/lib/terminology";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const G = "g-1";

describe("TC2: a team-sport group's short menu", () => {
  it("only a group with its team switch on is a team-sport group", () => {
    expect(isTeamSportGroup(true)).toBe(true);
    expect(isTeamSportGroup(false)).toBe(false);
    expect(isTeamSportGroup(null)).toBe(false);
    expect(isTeamSportGroup(undefined)).toBe(false);
  });

  it("the menu is Athletes, Team calendar, Attendance, Depth chart, Team feed, Messages, Team performance; Challenges and Hall of fame sit under one More", () => {
    expect(teamSportMenu(G).map((m) => m.label)).toEqual(["Athletes", "Team calendar", "Attendance", "Depth chart", "Team feed", "Messages", "Team performance"]);
    expect(teamSportMoreMenu(G).map((m) => m.label)).toEqual(["Challenges", "Hall of fame", "Team sheet"]);
    // Athletes is this team's own roster (its Members view), not the coach-wide client list
    expect(teamSportMenu(G)[0].href).toBe(`/groups/${G}/clients?view=members`);
    expect(teamSportMenu(G)[1].href).toBe(`/groups/${G}/team/calendar`);
  });

  it("none of the dropped entries is in it: Group dashboard, Group calendar, Group sessions, Business, a separate kiosk", () => {
    const all = [...teamSportMenu(G), ...teamSportMoreMenu(G)].map((m) => `${m.key} ${m.label} ${m.href}`).join("\n").toLowerCase();
    for (const word of ["dashboard", "group calendar", "group-calendar", "group sessions", "group-sessions", "business", "kiosk"]) expect(all).not.toContain(word);
  });

  it("no label says Clients", () => {
    expect([...teamSportMenu(G), ...teamSportMoreMenu(G)].map((m) => m.label).join(" ").toLowerCase()).not.toContain("client");
  });

  it("the Business area is one quiet link in Settings, and the money tiles are hidden on a phone", () => {
    expect(TEAM_SPORT_BUSINESS_LABEL).toBe("Business tools (off for teams)");
    expect(teamSportBusinessHref(G)).toBe(`/groups/${G}/business`);
    expect(TEAM_SPORT_HIDDEN_HUB_TILES).toEqual(["business", "quick-payment"]);
  });

  it("the word for a client is athletes in a team-sport group unless the coach chose their own word", () => {
    expect(resolveTerm(withTeamSportWords({}, true), "client", "plural")).toBe("athletes");
    expect(resolveTerm(withTeamSportWords({}, true), "client", "singular")).toBe("athlete");
    expect(resolveTerm(withTeamSportWords({}, false), "client", "plural")).toBe("clients");
    expect(resolveTerm(withTeamSportWords({ client: { kind: "custom", value: "players" } }, true), "client", "plural")).toBe("players");
    expect(resolveTerm(withTeamSportWords({ client: { kind: "preset", value: "member" } }, true), "client", "plural")).toBe("members");
    // other words are untouched
    expect(resolveTerm(withTeamSportWords({}, true), "coach", "plural")).toBe("coaches");
  });
});

describe("TC2: the menus use it", () => {
  const shell = src("components/coach/coach-desktop-shell.tsx");

  it("the computer menu switches to the team menu for a team-sport group, never on a coach-level page", () => {
    expect(shell).toContain("const teamSport = isTeamSportGroup(teamMode) && !coachLevel;");
    expect(shell).toContain("const nav: NavEntry[] = teamSport ? teamNav : ordinaryNav;");
    const team = shell.slice(shell.indexOf("// The team-sport menu:"), shell.indexOf("const nav: NavEntry[] = teamSport"));
    expect(team).toContain("teamSportMenu(groupId)");
    expect(team).toContain('label: "More"');
    expect(team).toContain("teamSportMoreMenu(groupId)");
    // no Business group, no Group group, no dashboard / group calendar / group sessions, no kiosk entry of its own
    expect(team).not.toContain('label: "Business"');
    expect(team).not.toContain('label: "Group"');
    expect(team).not.toContain("group-calendar");
    expect(team).not.toContain("group-sessions");
    expect(team).not.toContain('"dashboard"');
    expect(team).toContain('i.key !== "kiosk"');
    // Business is reachable from Settings
    expect(team).toContain("TEAM_SPORT_BUSINESS_LABEL");
    // Athletes follows the coach's word
    expect(team).toContain('termKey: "client" as const');
    // the ordinary menu is unchanged for everything else
    expect(shell).toContain('{ key: "clients", label: "Clients", href: CLIENTS_HREF');
    expect(shell).toContain('label: "Business",');
  });

  it("the phone More list drops Business, Group sessions and the booking tools for a team-sport group, and shows its menu", () => {
    const m = src("components/coach/mobile/coach-nav-links-list.tsx");
    expect(m).toContain("const teamSport = isTeamSportGroup(teamMode);");
    expect(m).toContain("teamSportMenu(groupId)");
    expect(m).toContain('{!teamSport && <Item href={`/groups/${groupId}/business`} label="Business overview"');
    expect(m).toContain("{!teamSport && (\n              <>\n                <GroupHeader label=\"Business\"");
    expect(m).toContain('{!teamSport && <Item href={`/groups/${groupId}/group-sessions`}');
    expect(m).toContain("teamSportBusinessHref(groupId)");
  });

  it("the phone Spotlight hub hides the Business and Quick payment tiles for a team-sport group", () => {
    const h = src("components/coach/mobile/coach-spot-hub.tsx");
    expect(h).toContain("TILES.filter((tile) => !(teamSport && TEAM_SPORT_HIDDEN_HUB_TILES.includes(tile.key)))");
    expect(h).toContain('.select("team_mode")');
  });

  it("every page's words follow the group: the terminology provider reads the group's team switch", () => {
    const p = src("components/coach/terminology-provider.tsx");
    expect(p).toContain('.select("organization_id, team_mode")');
    expect(p).toContain("withTeamSportWords(saved, teamSport)");
  });
});

describe("TC2: Attendance and the kiosk are one place", () => {
  it("the Attendance page has the Open check-in kiosk button and the PIN settings link", () => {
    const a = src("app/(coach)/groups/[groupId]/attendance/page.tsx");
    expect(a).toContain("Open check-in kiosk");
    expect(a).toContain("`/groups/${params.groupId}/kiosk`");
    expect(a).toContain("`/groups/${params.groupId}/kiosk/settings`");
  });

  it("they are the same data: attendance reads kiosk_checkins, which is the table the kiosk writes", () => {
    expect(src("lib/attendance.ts")).toContain('from("kiosk_checkins")');
    expect(src("app/api/kiosk/checkin/route.ts")).toContain('from("kiosk_checkins")');
    // the kiosk's own URL keeps working
    expect(src("app/(coach)/groups/[groupId]/kiosk/page.tsx")).toContain("KioskCheckinScreen");
  });
});

describe("TC2: where a group is made a team sport, and one view of the athletes", () => {
  it("the group's Settings has a plain switch for it (not for a one-on-one space)", () => {
    const s = src("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(s).toContain("<TeamSportToggle ");
    expect(s).toContain('.select("gamification_enabled, name, group_kind, team_mode")');
    expect(s).toContain('group_kind !== "one_on_one" && (');
    const t = src("components/coach/team-sport-toggle.tsx");
    expect(t).toContain("This group is a team sport");
    expect(t).toContain('update({ team_mode: next })');
    // a failed save puts the switch back and says so
    expect(t).toContain("setEnabled(!next);");
  });

  it("a team-sport roster has no card-size choice, and an all-team organization's list has one view and no kind filters", () => {
    const grid = src("components/coach/desktop/client-card-grid.tsx");
    expect(grid).toContain("{!teamSport && <CardSizeToggle ");
    expect(src("app/(coach)/groups/[groupId]/clients/page.tsx")).toContain("teamSport={group?.team_mode === true}");
    const list = src("components/coach/desktop/coach-clients-list.tsx");
    expect(list).toContain('const view: ClientsView = oneView ? "list" : savedView;');
    expect(list).toContain("{!oneView && FILTERS.map(");
    expect(list).toContain("{!oneView && (");
    expect(src("app/(coach)/clients/page.tsx")).toContain("oneView={oneView}");
  });

  it("the whole-team message stays reachable from Messages", () => {
    expect(src("app/(coach)/groups/[groupId]/messages/page.tsx")).toContain("/messages/announce");
  });
});

describe("TC2: the Coaches list on the coach-level Clients page covers the whole organization", () => {
  it("one row per person across every group of the organization, with the organization role and pending marked", () => {
    const lib = src("lib/pending-coaches.ts");
    expect(lib).toContain("export async function loadOrgCoaches(");
    expect(lib).toContain('groups!inner ( organization_id )');
    expect(lib).toContain('.eq("groups.organization_id", organizationId)');
    expect(lib).toContain("if (!seen.has(s.profile_id)) seen.set(s.profile_id, s);");
    expect(lib).toContain("loadPendingInvitees(");
    // a failed read lists nobody rather than a partial list that looks complete
    expect(lib).toContain("if (seats.failed) return { organizationId, coaches: [], pending: [] };");
    expect(src("app/(coach)/clients/page.tsx")).toContain("loadOrgCoaches(anchor.id)");
  });
});
