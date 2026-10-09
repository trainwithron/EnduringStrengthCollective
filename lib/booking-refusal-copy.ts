// What the booking functions refuse with, in plain words for the client. Each rule matches a phrase the database function raises; anything not
// listed gets a generic line, never "That slot was just taken", which would be false for most refusals.
const RULES: [RegExp, string][] = [
  [/more advance notice/, "That time is too soon. Your coach needs more notice than that."],
  [/already started/, "That session has already started. Ask your coach."],
  [/confirms moves/, "Your coach confirms moves. Ask for the new time instead."],
  [/schedules your sessions/, "Your coach schedules your sessions. Ask them to make this change."],
  [/confirms new sessions/, "Your coach confirms new sessions. Send a request instead."],
  [/you can (book|move) this directly/, "Your coach's booking setting changed. Reload and try again."],
  [/time has already passed/, "That time has already passed."],
  [/outside your coach/, "That time is outside your coach's hours."],
  [/just taken/, "That slot was just taken. Try another."],
  [/no session credits/, "You have no sessions left to book with."],
  [/already asked/, "You already asked to move this session. Your coach has not answered yet."],
  [/3 requests waiting/, "You already have 3 requests waiting for your coach."],
  [/not in a (re)?schedulable state|not in a movable state|not in a reschedulable state/, "This session can no longer be moved."],
  [/time zone yet/, "Your coach has not finished setting up their hours yet."],
];

export const BOOKING_REFUSAL_FALLBACK = "That didn't go through. Nothing was changed. Try again.";

export function bookingRefusalMessage(serverMessage: string | null | undefined, fallback: string = BOOKING_REFUSAL_FALLBACK): string {
  const text = serverMessage ?? "";
  for (const [pattern, sentence] of RULES) if (pattern.test(text)) return sentence;
  return fallback;
}

// The calendar days (as dates) of the weekly sessions that were asked for but are not among the ones that got booked, so a client can be told which
// ones to book by hand. A session counts as booked when one was booked on the same calendar day, in the viewer's zone.
export function failedWeeklyDates(firstStartAt: string, occurrences: number, bookedStartAts: string[]): Date[] {
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const booked = new Set(bookedStartAts.map((iso) => dayKey(new Date(iso))));
  const failed: Date[] = [];
  for (let i = 0; i < occurrences; i++) {
    const d = new Date(firstStartAt);
    d.setDate(d.getDate() + 7 * i);
    if (!booked.has(dayKey(d))) failed.push(d);
  }
  return failed;
}
