// Group events: "monthly gym workout, then lunch" for one group. Members answer In or Out and it never costs a session. The database does the real work
// (supabase/migrations/0323_group_events.sql); this is what the screens say and the checks that stop a bad form before it is sent.

// A member's answer. "joined" is In, "cancelled" is Out (written down even if they never said In), no row is no answer yet.
export type EventAnswer = "in" | "out" | "waiting" | "there" | "none";

export function eventAnswer(status: string | null | undefined): EventAnswer {
  if (status === "joined") return "in";
  if (status === "cancelled") return "out";
  if (status === "waitlisted") return "waiting";
  if (status === "attended") return "there";
  return "none";
}

export function answerLabel(answer: EventAnswer): string {
  switch (answer) {
    case "in":
      return "You're in";
    case "out":
      return "You're out";
    case "waiting":
      return "You're on the waiting list";
    case "there":
      return "You were there";
    default:
      return "No answer yet";
  }
}

export interface EventInput {
  title: string;
  startIso: string;
  durationMinutes: number;
  place?: string;
  note?: string;
  // Optional limit on spots; blank or 0 means no limit.
  capacity?: number | null;
}

// Why a new event cannot be created yet, or null.
export function eventProblem(input: EventInput, now: Date): string | null {
  if (!input.title.trim()) return "Give the event a name.";
  if (input.title.trim().length > 80) return "Keep the name under 80 characters.";
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) return "Pick a date and time.";
  if (start.getTime() <= now.getTime()) return "Pick a time in the future.";
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 1440) return "Pick a length between 5 minutes and 24 hours.";
  if ((input.place ?? "").length > 200) return "Keep the place under 200 characters.";
  if ((input.note ?? "").length > 500) return "Keep the note under 500 characters.";
  if (input.capacity != null && input.capacity !== 0 && (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50)) return "Spots must be between 1 and 50, or left blank for no limit.";
  return null;
}

// The one announcement posted to the group's feed. `when` is already written in the coach's time zone.
export function eventPostBody(opts: { coachName: string; title: string; when: string; place?: string | null }): string {
  const where = opts.place ? ` at ${opts.place}` : "";
  return `${opts.coachName} scheduled ${opts.title} for ${opts.when}${where}. Are you in or out?`;
}

// What the database says when it refuses, in words for the screen.
export function friendlyEventError(message: string | undefined): string {
  const m = message ?? "";
  if (/time is already taken/i.test(m)) return "You already have something booked at that time.";
  if (/future/i.test(m)) return "Pick a time in the future.";
  if (/cancelled/i.test(m)) return "This event was cancelled.";
  if (/already started/i.test(m)) return "This event has already started.";
  if (/not a member/i.test(m)) return "Only members of this group can answer.";
  if (/already marked as there/i.test(m)) return "You were already marked as there.";
  if (/not authorized/i.test(m)) return "You can't do that.";
  if (/event not found/i.test(m)) return "That event isn't there any more.";
  return "That didn't work. Try again.";
}
