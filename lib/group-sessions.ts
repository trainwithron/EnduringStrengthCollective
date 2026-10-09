// Small-group sessions: the words and rules around spots, joining and the waiting list. The database enforces capacity itself
// (supabase/migrations/0263_group_sessions.sql); this is what the screens say about it, and the checks that stop a bad form
// before it is sent.

export type AttendeeStatus = "joined" | "waitlisted" | "cancelled" | "attended";

export function spotsLeft(capacity: number, joined: number): number {
  return Math.max(0, capacity - joined);
}

export type JoinAction = "join" | "waitlist" | "leave" | "none";

export interface JoinView {
  // What the button does.
  action: JoinAction;
  label: string;
  // A short line under it.
  note: string | null;
  // The button is disabled (a reason is shown in `note`).
  disabled: boolean;
}

// What a client sees on one class. `mine` is their own attendee status, if any. `balance` is their session balance (null when
// they have no balance row). A client needs a session to take a spot, but not to join the waiting list.
export function joinView(opts: {
  capacity: number;
  joined: number;
  mine: AttendeeStatus | null;
  balance: number | null;
  started: boolean;
  cancelled: boolean;
}): JoinView {
  if (opts.cancelled) return { action: "none", label: "Cancelled", note: null, disabled: true };
  if (opts.mine === "joined") return { action: "leave", label: "Leave", note: "You're in.", disabled: opts.started };
  if (opts.mine === "attended") return { action: "none", label: "Attended", note: null, disabled: true };
  if (opts.mine === "waitlisted") return { action: "leave", label: "Leave waiting list", note: "You're on the waiting list. You move in if a spot opens.", disabled: opts.started };
  if (opts.started) return { action: "none", label: "Started", note: null, disabled: true };
  const left = spotsLeft(opts.capacity, opts.joined);
  if (left === 0) return { action: "waitlist", label: "Join waiting list", note: "This group session is full.", disabled: false };
  if ((opts.balance ?? 0) <= 0) {
    return { action: "join", label: "Join", note: "You need a session on your account to join. Your coach can add one.", disabled: true };
  }
  return { action: "join", label: "Join", note: `${left} ${left === 1 ? "spot" : "spots"} left`, disabled: false };
}

export interface CreateInput {
  title: string;
  startIso: string;
  durationMinutes: number;
  capacity: number;
  locationNote?: string;
}

// Why a new class cannot be created yet, or null.
export function createProblem(input: CreateInput, now: Date): string | null {
  if (!input.title.trim()) return "Give the group session a name.";
  if (input.title.trim().length > 80) return "Keep the name under 80 characters.";
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) return "Pick a date and time.";
  if (start.getTime() <= now.getTime()) return "Pick a time in the future.";
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 480) return "Pick a length between 5 minutes and 8 hours.";
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50) return "Spots must be between 1 and 50.";
  if ((input.locationNote ?? "").length > 200) return "Keep the place note under 200 characters.";
  return null;
}

// What the database says when it refuses, in words for the screen.
export function friendlyGroupSessionError(message: string | undefined): string {
  const m = message ?? "";
  if (/no session credits/i.test(m)) return "You need a session on your account to join. Your coach can add one.";
  if (/already in this class/i.test(m)) return "You're already in this group session.";
  if (/cancelled/i.test(m)) return "This group session was cancelled.";
  if (/already started/i.test(m)) return "This group session has already started.";
  if (/not a training client/i.test(m)) return "Only this coach's clients can join.";
  if (/time is already taken/i.test(m)) return "You're already booked at that time.";
  if (/future/i.test(m)) return "Pick a time in the future.";
  if (/there are \d+ people in this class/i.test(m)) return m.replace(/^.*?there are/i, "There are").replace(/this class/i, "this group session");
  if (/not authorized/i.test(m)) return "You can't do that.";
  return "That didn't work. Try again.";
}

export function classSummaryLine(opts: { capacity: number; joined: number; waitlisted: number }): string {
  const left = spotsLeft(opts.capacity, opts.joined);
  const base = left === 0 ? `Full (${opts.capacity})` : `${opts.joined} of ${opts.capacity} spots taken`;
  return opts.waitlisted > 0 ? `${base}, ${opts.waitlisted} waiting` : base;
}
