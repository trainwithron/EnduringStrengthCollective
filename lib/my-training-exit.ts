// "My training" is a deliberate visit: a coach opens it on purpose (the hub's Start your own workout, the My training item in the desktop nav, Assign to Myself), and three cookies keep them in their
// own client app for 12 hours (the layout is the device's own; a tablet's chosen layout is not touched). Landing on any COACH page (Home, Programs, Calendar, Clients, the Business page and the like) ends the visit: the cookies are cleared and the coach screen is shown, instead of
// redirecting back into the client view. "Back to coaching" in the bar stays the explicit way out.
export const MY_TRAINING_COOKIES = {
  actingAs: "acting_as_athlete",
  actingAsSelf: "acting_as_self",
} as const;

const TOP_LEVEL_COACH_PAGES = /^\/(dashboard|programs|calendar|clients|group-calendar)(\/|$)/;
// Pages under a group that only a coach uses (a client's own pages, such as their program or calendar, are not here).
const GROUP_COACH_PAGES = /^\/groups\/[0-9a-f-]{36}\/(dashboard|business|clients|athletes|packages|availability|group-sessions|revenue-splits|branding)(\/|$)/i;

export function isCoachOnlyPath(pathname: string): boolean {
  return TOP_LEVEL_COACH_PAGES.test(pathname) || GROUP_COACH_PAGES.test(pathname);
}

// True when the visit to My training should end because of where the coach just went.
export function shouldLeaveMyTraining(pathname: string, actingAsSelfCookie: string | undefined): boolean {
  return actingAsSelfCookie === "1" && isCoachOnlyPath(pathname);
}
