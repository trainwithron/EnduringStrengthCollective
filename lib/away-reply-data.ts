import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";

export interface AwayReplyView {
  setting: { enabled: boolean; message: string; endsOn: string | null } | null;
  today: string;
}

// The coach's away-reply setting and today's date in their own time zone. Returns null when the table is not there yet (before the 0315 database update) so the card is simply not shown.
export async function loadAwayReply(supabase: SupabaseClient, coachId: string): Promise<AwayReplyView | null> {
  const [{ data, error }, { data: profile }] = await Promise.all([
    supabase.from("coach_away_replies").select("enabled, message, ends_on").eq("coach_id", coachId).maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", coachId).maybeSingle(),
  ]);
  if (error) return null;
  const tz = (profile as { timezone?: string | null } | null)?.timezone;
  const today = dateKeyInZone(isValidTimeZone(tz) ? tz : DEFAULT_COACH_TIMEZONE);
  const row = data as { enabled: boolean; message: string; ends_on: string | null } | null;
  return { setting: row ? { enabled: row.enabled, message: row.message, endsOn: row.ends_on } : null, today };
}
