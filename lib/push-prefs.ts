import { DEFAULT_COACH_TIMEZONE, nowInZone } from "@/lib/timezone";

// A person's push preferences: an hour range when nothing is pushed to their phone (in their own time zone; the notice is still in the app), and whether the lock screen shows details or only "a new notification".
export interface PushPrefs {
  quietStart: number | null;
  quietEnd: number | null;
  generic: boolean;
  timeZone: string;
}

export const GENERIC_PUSH_TITLE = "Spotlight Coaching";
export const GENERIC_PUSH_BODY = "You have a new notification.";

// True when `hour` (0 to 23) falls in the quiet window. The window runs from the start hour up to (not including) the end hour and may wrap past midnight (22 to 6). No start, no end, or the same
// hour for both means no quiet hours.
export function inQuietHours(hour: number, start: number | null | undefined, end: number | null | undefined): boolean {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function isQuietNow(prefs: Pick<PushPrefs, "quietStart" | "quietEnd" | "timeZone">, now: Date = new Date()): boolean {
  return inQuietHours(nowInZone(prefs.timeZone || DEFAULT_COACH_TIMEZONE, now).getUTCHours(), prefs.quietStart, prefs.quietEnd);
}

// What the phone is shown: the real words, or the generic line when the person asked for private lock screens.
export function pushContent(prefs: Pick<PushPrefs, "generic">, title: string, body: string): { title: string; body: string } {
  return prefs.generic ? { title: GENERIC_PUSH_TITLE, body: GENERIC_PUSH_BODY } : { title, body };
}

// Reads the preferences with whatever client the caller has (profiles are readable). A database without the columns yet, or a failed read, means no quiet hours and real text: a push is never lost to a missing setting.
export async function readPushPrefs(supabase: any, profileId: string): Promise<PushPrefs> {
  const fallback: PushPrefs = { quietStart: null, quietEnd: null, generic: false, timeZone: DEFAULT_COACH_TIMEZONE };
  try {
    const { data, error } = await supabase.from("profiles").select("quiet_hours_start, quiet_hours_end, generic_push_text, timezone").eq("id", profileId).maybeSingle();
    if (error || !data) {
      const { data: zoneOnly } = await supabase.from("profiles").select("timezone").eq("id", profileId).maybeSingle();
      return { ...fallback, timeZone: (zoneOnly as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE };
    }
    const row = data as { quiet_hours_start?: number | null; quiet_hours_end?: number | null; generic_push_text?: boolean | null; timezone?: string | null };
    return { quietStart: row.quiet_hours_start ?? null, quietEnd: row.quiet_hours_end ?? null, generic: row.generic_push_text === true, timeZone: row.timezone || DEFAULT_COACH_TIMEZONE };
  } catch {
    return fallback;
  }
}
