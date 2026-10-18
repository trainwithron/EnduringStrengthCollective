import { membersHref } from "@/lib/coach-clients-nav";
import type { CoachType } from "@/lib/coach-type";

// The team coach (Ron, Oct 17): a coach who said at signup that they coach "a team or a class" (profiles.coach_type = 'team') gets the team home, and the business tools that only make sense for selling to clients are
// left out of their menus: booking pages and availability, session types, the website, the pro shop and referrals, leads and the session ledger. Nothing is removed from the app and the pages still open for anyone who
// goes to them; this only decides what the menus show. A coach who changes what they coach in Settings gets the other menus back.
export const TEAM_COACH_HIDDEN_NAV = new Set(["resources", "website", "availability", "session-types", "booking-page", "leads", "session-ledger"]);

export const hiddenForCoachType = (type: CoachType | string | null | undefined, navKey: string): boolean => type === "team" && TEAM_COACH_HIDDEN_NAV.has(navKey);

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
