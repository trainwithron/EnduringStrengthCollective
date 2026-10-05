// What a client sees about their session balance. Before a coach has added any sessions (or any package exists)
// a balance of 0 is the normal starting state, not a warning, so the wording stays neutral.
export const NO_SESSIONS_LINE = "No sessions on your account right now";
export const NO_SESSIONS_SLOT_LABEL = "No sessions on your account yet";
export const NO_PACKAGES_LINE = "Your coach hasn't added sessions yet. Message them to get set up.";
export const CANT_BOOK_NO_SESSIONS = "You don't have a session to book with yet. Your coach can add one.";

export function sessionBalanceLine(balance: number): string {
  return balance > 0 ? `Session credits available: ${balance}` : NO_SESSIONS_LINE;
}
