// The push a client gets after their coach marks a session attended (Ron, Oct 19): plain, one per marked session, only in the client's daytime. The coach is the only one who marks; the client never does.
export const CLIENT_PUSH_FROM_HOUR = 7;
export const CLIENT_PUSH_TO_HOUR = 21;

/** True from 7:00 to 20:59 in the client's own time zone. */
export function clientMayBePushedAt(hour: number): boolean {
  return hour >= CLIENT_PUSH_FROM_HOUR && hour < CLIENT_PUSH_TO_HOUR;
}

export function completedSessionPush(coachFullName: string | null | undefined, balance: number | null | undefined): { title: string; body: string } {
  const first = (coachFullName ?? "").trim().split(/\s+/)[0] || "your coach";
  const lead = `Good job completing your session with ${first} today.`;
  if (balance === null || balance === undefined) return { title: "Good job today", body: lead };
  if (balance <= 0) return { title: "Good job today", body: `${lead} That was your last session. Ask ${first} about renewing.` };
  return { title: "Good job today", body: `${lead} You have ${balance} ${balance === 1 ? "session" : "sessions"} left.` };
}
