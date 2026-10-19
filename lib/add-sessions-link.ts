// Where a notice about a client's sessions running low takes the coach: the exact place sessions are ADDED. On the client's profile that is the "Assign sessions" block in the Settings tab; the link opens that tab
// and scrolls to it. Several clients at once go to a short "Running low" list whose every row has an Add sessions button that goes to the same place (Ron, Oct 19: the notice "took me to a place that I can't add her sessions").
export const ADD_SESSIONS_ANCHOR = "add-sessions";
export const RUNNING_LOW_PATH = "/running-low";

export function addSessionsHref(groupId: string, athleteId: string): string {
  return `/groups/${groupId}/athletes/${athleteId}?tab=settings#${ADD_SESSIONS_ANCHOR}`;
}

/** Running low = 1 left or none (the same two levels the daily digest tells the coach about). */
export const RUNNING_LOW_AT = 1;
