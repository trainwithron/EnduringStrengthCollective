import type { SetLogEntry } from "@/lib/types";

// Rest the COACH prescribed, per set. When a coach gives a set a rest, the client gets exactly that rest for that set: the timer starts it by itself, there is
// no 60/90/120 picker, no +15 s, and a number the client types in the Rest cell does not replace it. Without a coach rest nothing changes (the picker, or a
// rest the client typed, as before).

// A rest above 30 minutes is almost always a slip (3000 for 300), so it is refused rather than saved.
export const MAX_REST_SECONDS = 1800;

// A time worked (the Time field): the same typing as rest, but allowed up to four hours (a long run or row is a legitimate target; a rest that long is a slip).
export const MAX_TIME_SECONDS = 14400;

// A bare number this small is probably minutes typed without a unit ("3" for 3:00), so the caller asks before saving it as seconds.
export const BARE_SECONDS_HINT_BELOW = 20;

// "5:00", "3:30", "300", "90s", "2m", "2m30" -> seconds. Empty or 0 is a valid "no rest" (null). Anything else that is not a time is refused. A bare number
// is seconds; `bare` is set when it is small enough that the coach probably meant minutes, so the caller can ask first.
export function parseRestInput(text: string, maxSeconds: number = MAX_REST_SECONDS): { ok: true; seconds: number | null; bare?: boolean } | { ok: false } {
  const t = text.trim().toLowerCase();
  if (t === "") return { ok: true, seconds: null };
  let seconds: number | null = null;
  let bare = false;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,2}):([0-5]?\d)$/))) {
    seconds = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = t.match(/^(\d+)\s*(?:m|min|mins|minutes?)(?:\s*([0-5]?\d)\s*(?:s|sec|secs|seconds?)?)?$/))) {
    seconds = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  } else if ((m = t.match(/^(\d+)\s*(s|sec|secs|seconds?)?$/))) {
    seconds = Number(m[1]);
    bare = m[2] === undefined && seconds > 0 && seconds < BARE_SECONDS_HINT_BELOW;
  }
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0 || seconds > maxSeconds) return { ok: false };
  if (seconds === 0) return { ok: true, seconds: null };
  return bare ? { ok: true, seconds, bare: true } : { ok: true, seconds };
}

// 300 -> "5:00", 90 -> "1:30", 45 -> "0:45".
export function formatRest(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

export type RestSource = "coach" | "typed";
export interface RestForSet {
  seconds: number;
  source: RestSource;
}

type RestSet = Pick<SetLogEntry, "id" | "setOrder" | "targetRestSeconds" | "restSeconds">;

// The rest that applies after this set. (1) The set's own prescribed rest. (2) A set with no rest of its own (one the client added, or one the coach left blank; 0 counts
// as blank) uses the rest of the nearest earlier set that has one, so an exercise the coach gave a rest never falls back to the picker. (3) Only when the coach prescribed no rest at all: a rest
// the client typed, as before. (4) Otherwise nothing: the usual picker.
export function restForSet(sets: RestSet[], setId: string): RestForSet | null {
  const set = sets.find((s) => s.id === setId);
  if (!set) return null;
  const own = set.targetRestSeconds;
  if (own != null && own > 0) return { seconds: own, source: "coach" };
  let inherited: RestSet | null = null;
  for (const s of sets) {
    if (s.setOrder < set.setOrder && s.targetRestSeconds != null && s.targetRestSeconds > 0 && (inherited === null || s.setOrder > inherited.setOrder)) inherited = s;
  }
  if (inherited) return { seconds: inherited.targetRestSeconds as number, source: "coach" };
  if (set.restSeconds != null && set.restSeconds > 0) return { seconds: set.restSeconds, source: "typed" };
  return null;
}
