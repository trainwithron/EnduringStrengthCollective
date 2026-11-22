import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveAnchor } from "@/lib/active-anchor";
import { groupsInOrgOf } from "@/lib/coach-groups";
import { readRowsByIds } from "@/lib/read-by-ids";
import { addDaysToKey } from "@/lib/date-key";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { firstNameOf } from "@/lib/broadcast-merge";
import { PHONE_CALENDAR } from "@/lib/phone-coach-routes";

// The one quiet line under the greeting on a coach's phone Home (PH25, Ron Nov 21: the phone opens as his own account, and Home said nothing about today's coaching):
// "Today: 4 sessions · next Jane 3:00 PM". It opens his phone Calendar, whose Today list sits at the top. The same sessions as that list: the organization he is working in
// (one at a time, switched in Spotlight), his confirmed sessions today in his own time zone. Nothing is shown with no session today, or for someone who coaches no one.
export const COACH_TODAY_HREF = PHONE_CALENDAR;

export interface TodaySession {
  startAt: string;
  name: string;
}

/** The line, or null when there is no session today. "next" is the first one not yet started; when they have all started it is just the count. */
export function coachTodayLine(sessions: TodaySession[], now: Date, timeZone: string): string | null {
  if (sessions.length === 0) return null;
  const count = `Today: ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  const next = [...sessions].sort((a, b) => a.startAt.localeCompare(b.startAt)).find((s) => new Date(s.startAt).getTime() > now.getTime());
  return next ? `${count} · next ${firstNameOf(next.name)} ${formatInTimezone(new Date(next.startAt), timeZone, "time")}` : count;
}

/** Reads today's sessions the way the phone Calendar's Today list does. Any failure shows nothing. */
export async function loadCoachTodayLine(supabase: SupabaseClient, coachId: string, now: Date = new Date()): Promise<string | null> {
  try {
    const active = await getActiveAnchor(supabase, coachId);
    if (!active || active.needsChoice) return null;
    const groupIds = groupsInOrgOf(active.groups, active.anchor.id).map((g) => g.id);
    if (groupIds.length === 0) return null;
    const { data: me } = await supabase.from("profiles").select("timezone").eq("id", coachId).maybeSingle();
    const tz = (me as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
    const todayKey = dateKeyInZone(tz, now);
    const from = zonedTimeToUtc(todayKey, "00:00", tz).toISOString();
    const to = zonedTimeToUtc(addDaysToKey(todayKey, 1), "00:00", tz).toISOString();
    const { data, error } = await readRowsByIds(groupIds, (g) => (start, end) =>
      supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", coachId)
        .in("group_id", g)
        .eq("status", "confirmed")
        .gte("start_at", from)
        .lt("start_at", to)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    );
    if (error) return null;
    const sessions = ((data ?? []) as { start_at: string; profiles?: { full_name?: string | null } | null }[]).map((b) => ({ startAt: b.start_at, name: String(b.profiles?.full_name ?? "Client") }));
    return coachTodayLine(sessions, now, tz);
  } catch {
    return null;
  }
}
