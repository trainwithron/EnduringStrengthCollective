import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToProfile } from "@/lib/send-push";

// ONE place a coach-facing push goes through, so a coach's own switch for that KIND of notice is checked in the same place for everything that sends one (no job can get around it). The switch is a list of kinds the
// coach turned OFF (profiles.notices_off); a database without that column yet, an unreadable row or a failed read means the notice is ON (nothing a coach wants is lost to a missing setting).
export type CoachNoticeKind = "low_sessions";

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
  opts: { ignoreQuiet?: boolean } = {}
): Promise<number> {
  if (await coachNoticeIsOff(db, profileId, kind)) return 0;
  return sendPushToProfile(db, profileId, title, body, url, opts);
}
