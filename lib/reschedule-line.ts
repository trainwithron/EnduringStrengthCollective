// The one line over the times while a client moves a session (CL16, Nov 21): which session, and the one thing to know. With request booking the coach confirms the move; with
// self-booking a late move may count as a session (the coach is told, and decides).
export function rescheduleLine(sessionStart: Date, coachConfirms: boolean): string {
  const day = sessionStart.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  // (never "a session is taken": the coach decides whether a late move counts)
  return `Pick a new time for your ${day} session. ${coachConfirms ? "Your coach confirms it." : "If it is late, your coach decides whether it counts as a session."}`;
}
