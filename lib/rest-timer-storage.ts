// Persists an in-progress rest countdown across a reload or a quick
// nav-away-and-back — sessionStorage (not localStorage, per lib/card-size.ts's
// convention) since this is tied to one active workout session, not a
// lasting preference. Keyed by sessionId so switching sessions never
// resumes the wrong countdown.
export interface RestTimerState {
  startedAtMs: number;
  durationSeconds: number;
}

function storageKey(sessionId: string): string {
  return `esc-rest-timer-${sessionId}`;
}

export function readRestTimerState(sessionId: string): RestTimerState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.startedAtMs === "number" && typeof parsed?.durationSeconds === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRestTimerState(sessionId: string, state: RestTimerState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(sessionId), JSON.stringify(state));
  } catch {
    // Private-browsing / storage-blocked — the timer still runs for this
    // page view, it just won't resume correctly after a reload.
  }
}

export function clearRestTimerState(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(sessionId));
  } catch {
    // Non-fatal.
  }
}
