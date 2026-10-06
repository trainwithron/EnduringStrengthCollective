// The per-window session length (migration 0283: coach_availability_windows.session_minutes) is read on its own, apart from the windows themselves, so
// nothing that already loads a coach's hours can break before that database update is applied: if the column is not there the lookup fails quietly,
// the index is empty, and every window behaves exactly as it did (a session lasts as long as the slot step).

import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionMinutesIndex = Map<string, number>;

export const sessionMinutesKey = (coachId: string | null | undefined, weekday: number, startTime: string) =>
  `${coachId ?? ""}|${weekday}|${String(startTime).slice(0, 5)}`;

export async function fetchSessionMinutes(db: SupabaseClient | any, coachIds: string[]): Promise<SessionMinutesIndex> {
  const index: SessionMinutesIndex = new Map();
  const ids = Array.from(new Set(coachIds.filter(Boolean)));
  if (ids.length === 0) return index;
  try {
    const { data, error } = await db
      .from("coach_availability_windows")
      .select("coach_id, weekday, start_time, session_minutes")
      .in("coach_id", ids)
      .not("session_minutes", "is", null);
    if (error) return index;
    for (const r of (data ?? []) as { coach_id: string; weekday: number; start_time: string; session_minutes: number }[]) {
      index.set(sessionMinutesKey(r.coach_id, r.weekday, r.start_time), r.session_minutes);
    }
  } catch {
    // Treated as "not set up yet".
  }
  return index;
}

// The session length for one window row (`start_time` as read from the table), or undefined when none is set.
export function sessionMinutesFor(index: SessionMinutesIndex, coachId: string | null | undefined, w: { weekday: number; start_time: string }): number | undefined {
  return index.get(sessionMinutesKey(coachId, w.weekday, w.start_time));
}
