import { pageAll } from "@/lib/page-all";
import { dateKeyInZone } from "@/lib/timezone";

// Who was there, and when, for one group over a period. A person counts as PRESENT on a day (in the coach's time zone) when any of these happened that day: they checked in at the kiosk, they finished a workout
// in the group, or they were marked as attending a group session. The three are kept apart so a coach can see how each athlete is showing up (and the spreadsheet says which it was).
export type AttendanceSource = "kiosk" | "workout" | "session";

export interface AttendanceAthlete {
  athleteId: string;
  name: string;
  positionName: string | null;
  // date key -> sources that day
  days: Record<string, AttendanceSource[]>;
  daysPresent: number;
  lastPresent: string | null;
}

export interface Attendance {
  athletes: AttendanceAthlete[];
  // every calendar day in the period (in order), so a grid can be drawn
  dayKeys: string[];
  failed: boolean;
  truncated: boolean;
}

export function dayKeysBetween(fromDay: string, toDay: string, maxDays = 400): string[] {
  const out: string[] = [];
  let t = Date.parse(fromDay + "T00:00:00Z");
  const end = Date.parse(toDay + "T00:00:00Z");
  while (t <= end && out.length < maxDays) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export async function loadAttendance(supabase: any, args: { groupId: string; fromIso: string; toIso: string; fromDay: string; toDay: string; timeZone: string }): Promise<Attendance> {
  const { groupId, fromIso, toIso, timeZone } = args;
  const [members, kiosk, workouts, sessions] = await Promise.all([
    pageAll((from, to) => supabase.from("group_memberships").select("id, profile_id, position_id, profiles ( full_name ), group_positions ( name )").eq("group_id", groupId).eq("role", "athlete").order("id").range(from, to), { maxPages: 20 }),
    pageAll((from, to) => supabase.from("kiosk_checkins").select("id, athlete_id, checked_in_at").eq("group_id", groupId).gte("checked_in_at", fromIso).lt("checked_in_at", toIso).order("id").range(from, to), { maxPages: 100 }),
    pageAll((from, to) => supabase.from("athlete_sessions").select("id, athlete_id, completed_at").eq("group_id", groupId).eq("status", "completed").eq("is_historical", false).gte("completed_at", fromIso).lt("completed_at", toIso).order("id").range(from, to), { maxPages: 100 }),
    pageAll((from, to) => supabase.from("group_session_attendees").select("id, athlete_id, attended_at").eq("group_id", groupId).not("attended_at", "is", null).gte("attended_at", fromIso).lt("attended_at", toIso).order("id").range(from, to), { maxPages: 100 }),
  ]);

  const byAthlete = new Map<string, AttendanceAthlete>();
  for (const m of members.rows) {
    byAthlete.set(m.profile_id, { athleteId: m.profile_id, name: m.profiles?.full_name ?? "Member", positionName: m.group_positions?.name ?? null, days: {}, daysPresent: 0, lastPresent: null });
  }
  const mark = (athleteId: string, at: string | null, source: AttendanceSource) => {
    const a = byAthlete.get(athleteId);
    if (!a || !at) return;
    const day = dateKeyInZone(timeZone, new Date(at));
    const list = a.days[day] ?? (a.days[day] = []);
    if (!list.includes(source)) list.push(source);
  };
  for (const r of kiosk.rows) mark(r.athlete_id, r.checked_in_at, "kiosk");
  for (const r of workouts.rows) mark(r.athlete_id, r.completed_at, "workout");
  for (const r of sessions.rows) mark(r.athlete_id, r.attended_at, "session");

  const athletes = [...byAthlete.values()].map((a) => {
    const days = Object.keys(a.days).sort();
    return { ...a, daysPresent: days.length, lastPresent: days.length ? days[days.length - 1] : null };
  });
  athletes.sort((a, b) => a.name.localeCompare(b.name));

  return {
    athletes,
    dayKeys: dayKeysBetween(args.fromDay, args.toDay),
    failed: members.failed || kiosk.failed || workouts.failed || sessions.failed,
    truncated: members.truncated || kiosk.truncated || workouts.truncated || sessions.truncated,
  };
}
