import { membersHref } from "@/lib/coach-clients-nav";

// A team-sport group (groups.team_mode, the "Team sport" switch in the group's Settings) is run by a coach who has a roster of athletes, not clients who pay: its menus drop everything about selling (the Business area,
// quick payments), say "Athletes" instead of "Clients", and have ONE calendar (the team calendar) and ONE attendance place (attendance with the check-in kiosk inside it). Nothing is deleted; the pages still open for
// anyone who goes to them, this only decides what the menus and tiles show. Coach-level pages (Home, the all-clients list) are not a group's, so they keep the ordinary menus.
export const isTeamSportGroup = (teamMode: boolean | null | undefined): boolean => teamMode === true;

/** Phone Spotlight tiles that do not apply to a team-sport group: the money ones. */
export const TEAM_SPORT_HIDDEN_HUB_TILES: readonly string[] = ["business", "quick-payment"];

export interface TeamMenuItem {
  key: string;
  label: string;
  href: string;
}

/** The team-sport group's menu, in order (Home is the fixed first item of the rail and is not repeated here). "Athletes" is also reworded by the coach's own term setting. */
export function teamSportMenu(groupId: string): TeamMenuItem[] {
  return [
    { key: "members", label: "Athletes", href: membersHref(groupId) },
    { key: "team-calendar", label: "Team calendar", href: `/groups/${groupId}/team/calendar` },
    { key: "attendance", label: "Attendance", href: `/groups/${groupId}/attendance` },
    { key: "team", label: "Depth chart", href: `/groups/${groupId}/team` },
    { key: "feed", label: "Team feed", href: `/groups/${groupId}/feed` },
    { key: "messages", label: "Messages", href: `/groups/${groupId}/messages` },
    { key: "team-performance", label: "Team performance", href: `/groups/${groupId}/team-performance` },
  ];
}

/** Under one "More" in a team-sport group's menu. */
export function teamSportMoreMenu(groupId: string): TeamMenuItem[] {
  return [
    { key: "challenges", label: "Challenges", href: `/groups/${groupId}/challenges` },
    { key: "records", label: "Hall of fame", href: `/groups/${groupId}/records` },
    { key: "team-sheet", label: "Team sheet", href: `/groups/${groupId}/team-sheet` },
  ];
}

/** Where the Business area is for a team-sport group: one quiet link in Settings. */
export const TEAM_SPORT_BUSINESS_LABEL = "Business tools (off for teams)";
export const teamSportBusinessHref = (groupId: string): string => `/groups/${groupId}/business`;

/**
 * The coach's saved word choices, with one default added for a team-sport group: unless the coach has chosen their own word for "client", it reads "athlete" (so "Athletes" shows everywhere, never "Clients").
 * A word the coach chose themselves always wins; nothing is saved by this.
 */
export function withTeamSportWords(overrides: import("@/lib/terminology").TerminologyOverrides, teamSport: boolean): import("@/lib/terminology").TerminologyOverrides {
  if (!teamSport || overrides.client) return overrides;
  return { ...overrides, client: { kind: "preset", value: "athlete" } };
}

/** An organization whose groups are ALL team-sport groups (and there is at least one): a coach there is running a team, so no money numbers (MRR, income, payments) appear on their Home. */
export const orgIsTeamOnly = (groups: { team_mode?: boolean | null }[]): boolean => groups.length > 0 && groups.every((g) => isTeamSportGroup(g.team_mode));

/**
 * ONE rule for where the money numbers (Business tile and view, income, MRR, paying clients, the rail's Business icon) are hidden in the coach shell.
 * - On a group's own page: when that group is a team-sport group, or its organization is all team-sport groups.
 * - On a coach-level page (Home, Clients, Calendar, Programs; the group in the address is only an anchor for the rail): only when the organization is all team-sport groups, so a coach with a mix of teams and
 *   individual clients still sees their business there.
 */
export function moneyHiddenFor(opts: { coachLevel: boolean; groupIsTeamSport: boolean; orgTeamOnly: boolean }): boolean {
  return opts.orgTeamOnly || (!opts.coachLevel && opts.groupIsTeamSport);
}
