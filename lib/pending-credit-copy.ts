import { coachBalanceLabel } from "./reup";
import { NO_SESSIONS_LINE } from "./session-credit-copy";

// "2 left, 1 pending": a session the coach scheduled does not take a session from the client until it happens (marked attended, or the workout logged), so
// until then the balance stays put and the scheduled one is shown beside it. When more are pending than the client has left, the difference is owed.
// A client scheduling their own workouts never appears here: those cost nothing.

// Sessions that will be owed once every pending session is delivered.
export function owedAfterPending(balance: number, pending: number): number {
  return Math.max(0, pending - Math.max(0, balance));
}

// For the coach.
export function coachCreditLine(balance: number | null | undefined, pending: number): string {
  const base = coachBalanceLabel(balance);
  if (!pending || pending <= 0) return base;
  const have = balance ?? 0;
  const owed = owedAfterPending(have, pending);
  return owed > 0 ? `${base}, ${pending} pending (${owed} owed)` : `${base}, ${pending} pending`;
}

// For the client.
export function clientCreditLine(balance: number, pending: number): string {
  if (!pending || pending <= 0) return balance > 0 ? `${balance} ${balance === 1 ? "session" : "sessions"} left` : NO_SESSIONS_LINE;
  const left = balance > 0 ? `${balance} ${balance === 1 ? "session" : "sessions"} left` : "0 sessions left";
  return `${left} (${pending} scheduled)`;
}
