// The line shown in place of the "Use 1 session credit" box when the workout being started belongs to a booking (Oct 19 audit): the booking takes its own session off when the workout is finished, so the coach is
// told that instead of being asked. "This is the 3:00 PM session; it comes off Sawyer's sessions when you finish."
export function bookingCreditLine(startAt: Date, clientName?: string): string {
  const time = startAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const first = clientName?.trim().split(/\s+/)[0];
  return `This is the ${time} session; it comes off ${first ? `${first}'s` : "their"} sessions when you finish.`;
}
