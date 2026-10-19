// A workout a client left open or paused with sets already logged is the client's work: it is SAVED as finished, not closed as abandoned (Oct 19 audit: 4 abandoned sessions held 15, 8, 3 and 3 completed
// sets, and the coach saw nothing). The nightly job completes it with the same function the Complete button uses (complete_workout_session), dated when the last set was saved, and tells the coach.
// A session with no completed set is only paused, as before (close_stale_sessions). A session the COACH started for a client (logged_by_coach) is never completed here: finishing it can settle a booking's session.
export interface OpenSession {
  id: string;
  athlete_id: string;
  group_id: string;
  started_at: string;
  resumed_at: string | null;
}
export interface CompletedSet {
  session_id: string;
  at: string; // when it was saved (completed_at, else created_at)
}
export interface SessionToSave {
  id: string;
  athleteId: string;
  groupId: string;
  startedAt: string;
  lastSetAt: string;
  sets: number;
}

// Work left open for longer than this is not saved by the nightly job (a session from weeks ago would suddenly show as done, with records dated today): it stays paused for a person to look at.
export const SAVE_MAX_AGE_DAYS = 30;

export function pickSessionsToComplete(sessions: OpenSession[], sets: CompletedSet[], now: Date, days: number): SessionToSave[] {
  const cutoff = now.getTime() - days * 86400000;
  const oldest = now.getTime() - SAVE_MAX_AGE_DAYS * 86400000;
  const bySession = new Map<string, { n: number; last: number; lastIso: string }>();
  for (const s of sets) {
    const t = new Date(s.at).getTime();
    if (Number.isNaN(t)) continue;
    const cur = bySession.get(s.session_id);
    if (!cur) bySession.set(s.session_id, { n: 1, last: t, lastIso: s.at });
    else {
      cur.n += 1;
      if (t > cur.last) {
        cur.last = t;
        cur.lastIso = s.at;
      }
    }
  }
  const out: SessionToSave[] = [];
  for (const s of sessions) {
    const sets = bySession.get(s.id);
    if (!sets) continue;
    // nothing done since the cutoff: not started, resumed or saved a set within the period (a workout being logged right now is left alone)
    const resumed = s.resumed_at ? new Date(s.resumed_at).getTime() : 0;
    const started = new Date(s.started_at).getTime();
    const lastActivity = Math.max(started, resumed, sets.last);
    if (lastActivity >= cutoff || lastActivity < oldest) continue;
    out.push({ id: s.id, athleteId: s.athlete_id, groupId: s.group_id, startedAt: s.started_at, lastSetAt: sets.lastIso, sets: sets.n });
  }
  return out;
}

/** The time the saved workout took: from the start to the last set, never negative and never more than the 12 hours a session can honestly span. */
export function savedDurationSeconds(startedAtIso: string, lastSetAtIso: string): number {
  const s = Math.round((new Date(lastSetAtIso).getTime() - new Date(startedAtIso).getTime()) / 1000);
  return Math.max(0, Math.min(s, 12 * 3600));
}
