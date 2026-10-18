import { membersHref } from "@/lib/coach-clients-nav";
import type { CoachType } from "@/lib/coach-type";

// The team coach (Ron, Oct 17): a coach who said at signup that they coach "a team or a class" (profiles.coach_type = 'team') gets the team home, and the business tools that only make sense for selling to clients are
// left out of their menus: booking pages and availability, session types, the website, the pro shop and referrals, leads and the session ledger. Nothing is removed from the app and the pages still open for anyone who
// goes to them; this only decides what the menus show.
// coach_type is what the coach SAID, not what they do, so the menus are only trimmed for a coach who really only coaches teams: one with a one-on-one client, or who owns or administers an organization that is run with other people, keeps every menu
// (they use those tools). A coach who changes what they coach in Settings gets the other menus back at once.
export const TEAM_COACH_HIDDEN_NAV = new Set(["resources", "website", "availability", "session-types", "booking-page", "leads", "session-ledger"]);

export interface CoachNavFacts {
  coachType: CoachType | null;
  // The coach has a client of their own in a one-on-one space.
  hasOneOnOneClients: boolean;
  // The coach owns or administers an organization that has at least one other member (a coach or staff). The solo organization every self-signup coach gets does not count.
  runsOrgWithOthers: boolean;
}

export const tradesMenusAsTeamCoach = (facts: CoachNavFacts | null | undefined): boolean =>
  !!facts && facts.coachType === "team" && !facts.hasOneOnOneClients && !facts.runsOrgWithOthers;

export const hiddenForCoach = (facts: CoachNavFacts | null | undefined, navKey: string): boolean => tradesMenusAsTeamCoach(facts) && TEAM_COACH_HIDDEN_NAV.has(navKey);

export interface TeamHomeTile {
  key: string;
  label: string;
  hint: string;
  href: string;
  newTab?: boolean;
}

// The team coach's Home tiles, for the team they coach.
export function teamHomeTiles(groupId: string): TeamHomeTile[] {
  return [
    { key: "roster", label: "Roster", hint: "Your players, their positions and seasons.", href: membersHref(groupId) },
    { key: "depth", label: "Depth chart", hint: "Who plays where, by position.", href: `/groups/${groupId}/team` },
    { key: "calendar", label: "Practices and games", hint: "The team calendar.", href: `/groups/${groupId}/team/calendar` },
    { key: "attendance", label: "Attendance", hint: "Who was there, day by day.", href: `/groups/${groupId}/attendance` },
    { key: "weight-room", label: "Weight room", hint: "Check players in at the kiosk.", href: `/groups/${groupId}/kiosk` },
    { key: "tv", label: "TV display", hint: "Put the board on the weight-room screen.", href: `/groups/${groupId}/display`, newTab: true },
  ];
}

export interface TeamChoice {
  id: string;
  name: string;
}

// Which team the tiles are for: only teams the coach really coaches (never a retired season, never someone else's), the one they last worked in when there is one, else the first by name.
export function pickTileTeam(teams: TeamChoice[], rememberedGroupId: string | null): TeamChoice | null {
  if (teams.length === 0) return null;
  return teams.find((t) => t.id === rememberedGroupId) ?? [...teams].sort((a, b) => a.name.localeCompare(b.name))[0];
}
