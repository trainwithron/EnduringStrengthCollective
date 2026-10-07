import { addDaysToKey } from "@/lib/date-key";

// Real adherence-days computation from food_log_entries. A day counts as adherent if the client logged anything that day other than a skip: the point is whether they
// engaged, not whether every gram was exact ("one coffee counts as a logged day": a signal of engagement, not of accuracy).
//
// Days are plain date KEYS ("YYYY-MM-DD") counted back from today's key with calendar arithmetic. A job on a server in UTC, or a browser in a zone ahead of UTC, must
// not shift the window by a day, so no Date object is built from a key here. todayKey is the client's own calendar day.

export const ADHERENCE_WINDOW_DAYS = 7;
export const MIN_ADHERENT_DAYS = 5;

// The keys of the last N days, today first.
export function lastDayKeys(todayKey: string, windowDays = ADHERENCE_WINDOW_DAYS): string[] {
  return Array.from({ length: windowDays }, (_, i) => addDaysToKey(todayKey, -i));
}

export function computeAdherenceDays(entryDateKeys: string[], todayKey: string, windowDays = ADHERENCE_WINDOW_DAYS): number {
  const window = new Set(lastDayKeys(todayKey, windowDays));
  return new Set(entryDateKeys.filter((k) => window.has(k))).size;
}

// The dates of the entries that count: anything not skipped.
export function loggedDateKeys(entries: { log_date: string; status?: string | null }[]): string[] {
  return entries.filter((e) => e.status !== "skipped" && !!e.log_date).map((e) => e.log_date.slice(0, 10));
}

export interface AdherenceSummary {
  daysLogged: number;
  windowDays: number;
  // Fewer than 5 of 7: the engine holds calories steady and the card says why.
  heldForLowLogging: boolean;
  line: string;
}

export function summarizeAdherence(entries: { log_date: string; status?: string | null }[], todayKey: string, firstName = "They", windowDays = ADHERENCE_WINDOW_DAYS): AdherenceSummary {
  const daysLogged = computeAdherenceDays(loggedDateKeys(entries), todayKey, windowDays);
  const heldForLowLogging = daysLogged < MIN_ADHERENT_DAYS;
  const line = heldForLowLogging
    ? `${firstName} logged food on ${daysLogged} of ${windowDays} days, so calories are held steady until there is enough to go on.`
    : `${firstName} logged food on ${daysLogged} of ${windowDays} days.`;
  return { daysLogged, windowDays, heldForLowLogging, line };
}
