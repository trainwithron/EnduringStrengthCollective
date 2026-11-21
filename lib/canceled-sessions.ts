import type { SupabaseClient } from "@supabase/supabase-js";
import { readRowsByIds } from "@/lib/read-by-ids";

// A session the CLIENT cancelled stays on the coach's calendar, marked as cancelled (Ron, Nov 21: tapping "Client canceled" made it disappear). Shown, never counted, never blocking:
//   * which ones: a cancel the coach recorded with "Client canceled" (mark_client_cancelled), a late cancel by the client (Charge or Waive), or one the client made themselves
//     (bookings.cancelled_by is the client). A session the coach removed, a move (the old time of a moved session), and the coach's own placeholder for a group item stay off.
//   * where: the coach's month and week (computer and phone), the day panel and the day page. Never on the client's own calendar as upcoming, never in the counts, and the
//     time stays open (every open-times read keeps reading confirmed sessions only).

export const CANCELED_SELECT = "id, start_at, end_at, athlete_id, coach_id, group_id, cancelled_by, late_cancel, late_change_kind, late_charge_state, profiles!bookings_athlete_id_fkey ( full_name )";

export interface CanceledRow {
  id: string;
  start_at: string;
  end_at: string | null;
  athlete_id: string;
  coach_id: string;
  group_id: string;
  cancelled_by: string | null;
  late_cancel: boolean | null;
  late_change_kind: string | null;
  late_charge_state: string | null;
  profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null;
}

export interface CanceledSession {
  id: string;
  startAt: string;
  endAt: string | null;
  athleteId: string;
  groupId: string;
  name: string;
  /** "Client canceled", or "Canceled by Hewan" when the client did it themselves */
  label: string;
  /** "Charged", "Waived", "Waiting for you", or null when it was cancelled in time */
  state: string | null;
  lateState: "charged" | "waived" | "flagged" | null;
}

/** Was this cancelled session the client's cancel (and so shown to the coach)? */
export function isClientCancellation(r: Pick<CanceledRow, "athlete_id" | "coach_id" | "cancelled_by" | "late_cancel" | "late_change_kind">): boolean {
  if (r.athlete_id === r.coach_id) return false; // the coach's own placeholder for a group item
  if (r.late_change_kind === "cancel" || r.late_cancel === true) return true;
  return !!r.cancelled_by && r.cancelled_by === r.athlete_id;
}

export function lateStateLabel(state: string | null | undefined): string | null {
  return state === "charged" ? "Charged" : state === "waived" ? "Waived" : state === "flagged" ? "Waiting for you" : null;
}

export function toCanceledSession(r: CanceledRow): CanceledSession {
  const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  const name = (p?.full_name ?? "").trim() || "Client";
  const first = name.split(/\s+/)[0];
  const lateState = r.late_charge_state === "charged" || r.late_charge_state === "waived" || r.late_charge_state === "flagged" ? r.late_charge_state : null;
  return {
    id: r.id,
    startAt: r.start_at,
    endAt: r.end_at,
    athleteId: r.athlete_id,
    groupId: r.group_id,
    name,
    label: r.cancelled_by && r.cancelled_by === r.athlete_id ? `Canceled by ${first}` : "Client canceled",
    state: lateStateLabel(lateState),
    lateState,
  };
}

/** "Client canceled · Charged" */
export function canceledLine(s: Pick<CanceledSession, "label" | "state">): string {
  return s.state ? `${s.label} · ${s.state}` : s.label;
}

/**
 * The coach's client-cancelled sessions starting in [fromIso, toIso), across their groups. A failed read shows none (the calendar is never broken by it); the sessions on the
 * calendar are read separately, so this can never hide or block one.
 */
export async function readCanceledSessions(supabase: SupabaseClient, coachId: string, groupIds: string[], fromIso: string, toIso: string): Promise<CanceledSession[]> {
  try {
    const { data } = await readRowsByIds(groupIds, (g) => (from, to) =>
      supabase
        .from("bookings")
        .select(CANCELED_SELECT)
        .eq("coach_id", coachId)
        .in("group_id", g)
        .eq("status", "cancelled")
        .gte("start_at", fromIso)
        .lt("start_at", toIso)
        .order("id")
        .range(from, to)
    );
    return ((data ?? []) as CanceledRow[])
      .filter(isClientCancellation)
      .map(toCanceledSession)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  } catch {
    return [];
  }
}
