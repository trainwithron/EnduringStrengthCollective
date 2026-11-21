// The one line over the times while a client moves a session (CL16, Nov 21): which session, and the one thing to know. With request booking the coach confirms the move; with
// self-booking a late move may count as a session (the coach is told, and decides).
// The policy detail, in the step that confirms a self-booked move (CL16: it moved out of the line over the times, so it is said where the move is made).
export const MOVE_POLICY_LINE = "Moving it less than your coach’s cancellation window before the session lets your coach know, and they decide whether it counts as a session.";

export function rescheduleLine(sessionStart: Date, coachConfirms: boolean): string {
  const day = sessionStart.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  // (never "a session is taken": the coach decides whether a late move counts)
  return `Pick a new time for your ${day} session. ${coachConfirms ? "Your coach confirms it." : "If it is late, your coach decides whether it counts as a session."}`;
}
