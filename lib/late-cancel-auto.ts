// A coach's late-cancel setting (Ron, Nov 20, wave 2 C5: "as a per-coach setting"). OFF by default: a client cancelling inside the window is flagged and the coach picks Charge
// or Waive (Ron, Oct 6). ON: the session comes off the client's sessions at once (sessions only, never money), the coach is told, and one tap on Requests gives it back. Clients
// are told before they cancel, never surprised after (the research: "What clients hate are the surprise charges").

/** The client's confirm before a late cancel: what will happen, by the coach's setting. `takesSession` null = the setting could not be read, so the line covers both. */
export function lateCancelConfirmLine(windowHours: number, takesSession: boolean | null): string {
  if (takesSession === true) return `This is inside your coach's ${windowHours}-hour window, so it uses one of your sessions. Your coach can give it back. Cancel anyway?`;
  if (takesSession === null) return `This is inside your coach's ${windowHours}-hour window, so it may use one of your sessions. Cancel anyway?`;
  return `This is inside your coach's ${windowHours}-hour window. Your coach will be told and decides whether it counts as a session. Cancel anyway?`;
}

/** The coach's setting, read for the client's cancel button: true, false, or null when it could not be read. */
export async function readLateCancelTakesSession(db: any, coachId: string | null | undefined): Promise<boolean | null> {
  if (!coachId) return null;
  try {
    const { data, error } = await db.from("coach_booking_policies").select("late_cancel_takes_session").eq("coach_id", coachId).maybeSingle();
    if (error) return null;
    // no row: the coach never changed a booking setting, so it is off
    return (data as { late_cancel_takes_session?: boolean | null } | null)?.late_cancel_takes_session === true;
  } catch {
    return null;
  }
}

/** What a client's cancel button needs from the coach's policy: the window (24 hours with no policy row, as the database applies it) and the late-cancel setting. Read on its own,
 *  so a failure never touches the booking mode read beside it. */
export async function readClientCancelPolicy(db: any, coachId: string | null | undefined): Promise<{ windowHours: number | null; takesSession: boolean | null }> {
  if (!coachId) return { windowHours: null, takesSession: null };
  const [windowRead, takesSession] = await Promise.all([
    Promise.resolve(db.from("coach_booking_policies").select("cancellation_window_hours").eq("coach_id", coachId).maybeSingle()).catch(() => ({ data: null, error: true })),
    readLateCancelTakesSession(db, coachId),
  ]);
  const windowHours = (windowRead as { data: { cancellation_window_hours?: number | null } | null; error: unknown }).error
    ? null
    : ((windowRead as { data: { cancellation_window_hours?: number | null } | null }).data?.cancellation_window_hours ?? null);
  return { windowHours, takesSession };
}

/** Requests: how a charged late cancel reads. */
export function lateOutcome(r: { late_charge_state: string | null; late_charge_auto?: boolean | null }): string {
  if (r.late_charge_state === "charged") return r.late_charge_auto ? "Took one session (your late-cancel setting)" : "Charged one session";
  if (r.late_charge_state === "waived") return "Waived";
  return "Waiting";
}

/** A charged late CANCEL can be given back from Requests (a late move's charge stays with Charge or Waive as before). */
export function canGiveBack(r: { late_charge_state: string | null; late_change_kind: string | null }): boolean {
  return r.late_charge_state === "charged" && r.late_change_kind === "cancel";
}
