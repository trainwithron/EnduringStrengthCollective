import { isQuietNow, readPushPrefs, type PushPrefs } from "@/lib/push-prefs";
import { DEFAULT_COACH_TIMEZONE, nowInZone } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";

// A line for a client who just sent their coach a request while the COACH is in their quiet hours (Ron, Nov 20): "It's late. Your coach has quiet hours set. Expect a reply
// in the morning." Quiet hours are the coach's own setting, the same one their phone alerts follow (lib/push-prefs.ts); nothing about how or when the coach is told changes.
// When the quiet hours end later in the day rather than in the morning, it says when instead ("Expect a reply after 1:00 PM"), in the CLIENT's own time zone. "It's late." is
// said only when it is late where the client is (8 PM to 5 AM). Outside the coach's quiet hours, or with none set: no line.

export const LATE_FROM_HOUR = 20;
export const LATE_UNTIL_HOUR = 5;
// The coach's quiet hours ending between these hours (the client's clock) is "the morning".
export const MORNING_FROM_HOUR = 4;
export const MORNING_UNTIL_HOUR = 12;

const hourIn = (at: Date, timeZone: string) => nowInZone(timeZone, at).getUTCHours();
const dateIn = (at: Date, timeZone: string) => nowInZone(timeZone, at).toISOString().slice(0, 10);

/** When the coach's quiet hours end next, as a moment (the next time the coach's own clock reaches the end hour). */
export function quietEndsAt(coach: Pick<PushPrefs, "quietEnd" | "timeZone">, now: Date): Date | null {
  if (coach.quietEnd == null) return null;
  const local = nowInZone(coach.timeZone || DEFAULT_COACH_TIMEZONE, now);
  const minutesNow = local.getUTCHours() * 60 + local.getUTCMinutes();
  let wait = (coach.quietEnd * 60 - minutesNow + 1440) % 1440;
  if (wait === 0) wait = 1440;
  // back to the start of that minute, so the line says the hour itself ("after 7:00 AM", not 7:00 and some seconds)
  return new Date(Math.floor(now.getTime() / 60000) * 60000 + wait * 60000);
}

const clock = (at: Date, timeZone: string) => at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** The line, or null when the coach is not in their quiet hours (or has none). */
export function quietHoursNotice(coach: Pick<PushPrefs, "quietStart" | "quietEnd" | "timeZone">, clientTimeZone: string | null | undefined, now: Date = new Date()): string | null {
  if (!isQuietNow(coach, now)) return null;
  const end = quietEndsAt(coach, now);
  if (!end) return null;
  const zone = isValidTimeZone(clientTimeZone) ? clientTimeZone : coach.timeZone || DEFAULT_COACH_TIMEZONE;
  const hourNow = hourIn(now, zone);
  const late = hourNow >= LATE_FROM_HOUR || hourNow < LATE_UNTIL_HOUR;
  const endHour = hourIn(end, zone);
  const morning = endHour >= MORNING_FROM_HOUR && endHour < MORNING_UNTIL_HOUR;
  const lead = `${late ? "It's late. " : ""}Your coach has quiet hours set.`;
  if (morning) return `${lead} Expect a reply in the morning.`;
  const tomorrow = dateIn(end, zone) !== dateIn(now, zone) ? " tomorrow" : "";
  return `${lead} Expect a reply after ${clock(end, zone)}${tomorrow}.`;
}

/** The person's own time zone, as their device has it (for the line in the browser). */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** On the server, for a request sent from a coach's public page (the requester is not in the coach's groups yet, so their browser cannot read the coach's setting). Null on any
 *  failure. Only the line goes back to the requester, never the hours themselves. */
export async function coachQuietNotice(service: any, coachId: string, clientTimeZone: unknown, now: Date = new Date()): Promise<string | null> {
  try {
    const prefs = await readPushPrefs(service, coachId);
    return quietHoursNotice(prefs, typeof clientTimeZone === "string" ? clientTimeZone : null, now);
  } catch {
    return null;
  }
}
