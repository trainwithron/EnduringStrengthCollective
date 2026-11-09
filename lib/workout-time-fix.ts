// A timer left running (Ron, Nov 9): nearly every session is under 90 minutes, so anything longer asks "is this the correct time?".
export const LONG_WORKOUT_SECONDS = 90 * 60;
export const DEFAULT_FIX_MINUTES = 60;

export function looksTooLong(seconds: number | null | undefined): boolean {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > LONG_WORKOUT_SECONDS;
}

export function validFixMinutes(raw: unknown): number | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 600 ? n : null;
}

export function saveFixedTime(sessionId: string, minutes: number): Promise<boolean> {
  return fetch("/api/workouts/fix-time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, minutes }) })
    .then((r) => r.ok)
    .catch(() => false);
}
