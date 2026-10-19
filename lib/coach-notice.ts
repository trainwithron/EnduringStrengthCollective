import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToProfile } from "@/lib/send-push";
import { nowInZone } from "@/lib/timezone";
import { readPushPrefs } from "@/lib/push-prefs";

// ONE place a coach-facing push goes through, so a coach's own switch for that KIND of notice is checked in the same place for everything that sends one (no job can get around it). The switch is a list of kinds the
// coach turned OFF (profiles.notices_off); a database without that column yet, an unreadable row or a failed read means the notice is ON (nothing a coach wants is lost to a missing setting).
import type { CoachNoticeKind } from "@/lib/coach-notice-kinds";
export type { CoachNoticeKind };

// Background jobs run at fixed UTC times, which can be the middle of a coach's night. A job's push waits for the coach's daytime (7:00 to 20:59 in their own time zone) or is skipped; the notice in the app is unaffected.
export const DAYTIME_START_HOUR = 7;
export const DAYTIME_END_HOUR = 21;
export function isCoachDaytime(hour: number): boolean {
  return hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR;
}

export async function coachNoticeIsOff(db: SupabaseClient, profileId: string, kind: CoachNoticeKind): Promise<boolean> {
  try {
    const { data, error } = await db.from("profiles").select("notices_off").eq("id", profileId).maybeSingle();
    if (error || !data) return false;
    const off = (data as { notices_off?: string[] | null }).notices_off;
    return Array.isArray(off) && off.includes(kind);
  } catch {
    return false;
  }
}

/** A push to a coach about one KIND of notice: nothing is sent when they switched that kind off. Returns how many phones got it. */
export async function sendCoachPush(
  db: SupabaseClient,
  profileId: string,
  kind: CoachNoticeKind,
  title: string,
  body: string,
  url: string,
  opts: { ignoreQuiet?: boolean; daytimeOnly?: boolean } = {}
): Promise<number> {
  if (await coachNoticeIsOff(db, profileId, kind)) return 0;
  if (opts.daytimeOnly) {
    try {
      const prefs = await readPushPrefs(db, profileId);
      if (!isCoachDaytime(nowInZone(prefs.timeZone).getUTCHours())) return 0;
    } catch {
      // an unreadable time zone: send (a push is never lost to a bad setting)
    }
  }
  return opts.ignoreQuiet ? sendPushToProfile(db, profileId, title, body, url, { ignoreQuiet: true }) : sendPushToProfile(db, profileId, title, body, url);
}
