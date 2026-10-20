// FIX 3B (Ron, Oct 19): "hit the AI assistant button and say, add X to my calendar for the last hour ... and it would deduct the session." A client who comes in when they can; the coach
// wings it and often logs nothing. This is the deterministic part of that Ask Spot action: it reads the plain words ("add Sarah to my calendar for the last hour", "Sarah came in from
// 3 to 4", "log Sarah for the last 45 minutes"), works out the time today (never the future, never another day), and matches the name against the coach's own clients. It never
// touches the database and never guesses: a name that fits more than one client, or none, is asked about. Pure, so every phrase is tested.

export interface ClockSpec {
  h: number;
  m: number;
  meridiem: "am" | "pm" | null;
}

export type PastWindow =
  // "for the last hour", "for the last 45 minutes", nothing said (the coach's session length)
  | { kind: "last"; minutes: number | null }
  // "from 3 to 4", "3:30-4:15 pm", "between 3 and 4"
  | { kind: "range"; start: ClockSpec; end: ClockSpec }
  // "at 3" (for the coach's session length)
  | { kind: "at"; start: ClockSpec }
  // "tomorrow at 3", "next Tuesday", "yesterday": not this action
  | { kind: "not_today"; reason: "future" | "other_day" };

export interface PastSessionSpec {
  // As typed, lower case.
  name: string;
  window: PastWindow;
}

export const PAST_SESSION_LIMITS = { minMinutes: 5, maxMinutes: 480 } as const;

const NAME_STOP = /\b(my|the|calendar|session|sessions|a|an|to|for|from|in|on|at|today|it|me|i|we|they|them|everyone|someone|clients?|athletes?|buffer|gap)\b/;
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;

function clock(h: string, m: string | undefined, mer: string | undefined): ClockSpec | null {
  const hour = Number(h);
  const minute = m === undefined ? 0 : Number(m);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const meridiem = mer ? (mer.startsWith("a") ? "am" : "pm") : null;
  if (meridiem && (hour < 1 || hour > 12)) return null;
  return { h: hour, m: minute, meridiem };
}

// What comes after the name: the time said, or nothing. Null when there is something there that is not a time (never guessed).
export function parsePastWindow(rest: string): PastWindow | null {
  const t = rest
    .replace(/\b(today|just now|please|thanks|thank you)\b/g, " ")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(tomorrow|tonight|next|later|this evening|this afternoon|upcoming|in an hour|in \d+)\b/.test(t)) return { kind: "not_today", reason: "future" };
  if (/\b(yesterday|last (?:week|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|ago)\b/.test(t)) return { kind: "not_today", reason: "other_day" };
  if (t === "" || t === "came in" || t === "for a session") return { kind: "last", minutes: null };

  let m = t.match(/^(?:for )?(?:the )?(?:last|past) (?:hour|1 hour|one hour)$/) ?? t.match(/^for (?:an|one|1) hour$/);
  if (m) return { kind: "last", minutes: 60 };
  m = t.match(/^(?:for )?(?:the )?(?:last|past) half(?: an)? hour$/) ?? t.match(/^for half an hour$/);
  if (m) return { kind: "last", minutes: 30 };
  m = t.match(/^(?:for )?(?:the )?(?:last|past) (?:hour and a half|90 minutes|1\.5 hours)$/);
  if (m) return { kind: "last", minutes: 90 };
  m = t.match(/^(?:for )?(?:the )?(?:(?:last|past) )?(\d{1,3}) ?(?:min|mins|minutes)$/);
  if (m) return { kind: "last", minutes: Number(m[1]) };
  m = t.match(/^(?:for )?(?:the )?(?:last|past) (\d) hours?$/);
  if (m) return { kind: "last", minutes: Number(m[1]) * 60 };

  m = t.match(new RegExp(`^(?:from |between )?${CLOCK}\\s*(?:to|till|until|til|-|–|and)\\s*${CLOCK}$`));
  if (m) {
    const start = clock(m[1], m[2], m[3]);
    const end = clock(m[4], m[5], m[6]);
    return start && end ? { kind: "range", start, end } : null;
  }
  m = t.match(new RegExp(`^(?:at |around |about )${CLOCK}$`));
  if (m) {
    const start = clock(m[1], m[2], m[3]);
    return start ? { kind: "at", start } : null;
  }
  return null;
}

const cleanName = (s: string): string | null => {
  const name = s.replace(/^(?:my client |client )/, "").replace(/'s$/, "").trim();
  if (!name || name.length > 60 || /\d/.test(name)) return null;
  const words = name.split(" ");
  if (words.length > 4 || words.some((w) => !/^[a-z][a-z'.-]*$/.test(w))) return null;
  if (words.length === 1 && NAME_STOP.test(name)) return null;
  if (words.every((w) => NAME_STOP.test(w))) return null;
  return name;
};

// The request, or null when the words are not this action. `text` is already lower case with single spaces and no closing punctuation.
export function matchPastSession(text: string): PastSessionSpec | null {
  const shapes: RegExp[] = [
    // "add Sarah to my calendar for the last hour", "put Sarah on the calendar from 3 to 4"
    /^(?:please )?(?:add|put|log)\s+(.+?)\s+(?:to|on|onto|in|into)\s+(?:my |the )?calendar\b\s*(.*)$/,
    // "add a session for Sarah for the last hour", "log a session with Sarah from 3 to 4"
    /^(?:please )?(?:add|log|put)\s+(?:a |the )?session (?:for|with)\s+(.+?)\s*((?:for|from|between|at|today|just now)\b.*)?$/,
    // "log Sarah for the last hour", "add Sarah from 3 to 4"
    /^(?:please )?(?:log|add)\s+(.+?)\s+((?:for|from|between|at)\b.*)$/,
    // "Sarah came in from 3 to 4", "Sarah trained for the last hour"
    /^(.+?)\s+(?:came in|was in|was here|trained|worked out|showed up|came by|had a session)\b\s*(.*)$/,
  ];
  for (const shape of shapes) {
    const m = text.match(shape);
    if (!m) continue;
    const name = cleanName(m[1]);
    if (!name) continue;
    const window = parsePastWindow((m[2] ?? "").trim());
    if (!window) continue;
    return { name, window };
  }
  return null;
}

// ---- the time, today ----

const toMinutes = (c: ClockSpec, meridiem: "am" | "pm" | null): number => {
  if (meridiem === null) return c.h * 60 + c.m;
  return ((c.h % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + c.m;
};

// Every way a clock time without am or pm can be read, as minutes after midnight.
function readings(c: ClockSpec): number[] {
  if (c.meridiem) return [toMinutes(c, c.meridiem)];
  if (c.h === 0 || c.h > 12) return [toMinutes(c, null)];
  return [toMinutes(c, "am"), toMinutes(c, "pm")];
}

export type ResolvedWindow = { startMin: number; endMin: number } | { problem: string };

export const NOT_TODAY_FUTURE = "This only puts a session that already happened today on your calendar. To book one that is still to come, use your calendar.";
export const NOT_TODAY_OTHER_DAY = "I can only add a session from earlier today. For another day, add it from your calendar.";
export const NOT_FINISHED = "That session hasn't finished yet. Tell me the times, like \"from 3 to 3:45\", or ask me once it's over.";

// The session's start and end today, in minutes after midnight, from what was said and the time now (`nowMin`, in the coach's own time zone). "The last hour" ends at the last quarter
// hour (4:07 -> 3:00 to 4:00). Never in the future, never before midnight.
export function resolvePastWindow(w: PastWindow, nowMin: number, sessionMinutes: number): ResolvedWindow {
  const len = (n: number | null) => n ?? sessionMinutes;
  const tooLong = (n: number) => n < PAST_SESSION_LIMITS.minMinutes || n > PAST_SESSION_LIMITS.maxMinutes;
  if (w.kind === "not_today") return { problem: w.reason === "future" ? NOT_TODAY_FUTURE : NOT_TODAY_OTHER_DAY };
  if (w.kind === "last") {
    const minutes = len(w.minutes);
    if (tooLong(minutes)) return { problem: `A session from ${PAST_SESSION_LIMITS.minMinutes} minutes to ${PAST_SESSION_LIMITS.maxMinutes / 60} hours, please.` };
    const endMin = Math.floor(nowMin / 15) * 15;
    const startMin = endMin - minutes;
    if (startMin < 0) return { problem: NOT_TODAY_OTHER_DAY };
    return { startMin, endMin };
  }
  // Every reading of the times said, latest first: the one that has already finished is the one meant ("3 to 4" at 5 PM is the afternoon; at 9 AM there is no such session yet).
  const pairs: { startMin: number; endMin: number }[] = [];
  if (w.kind === "at") {
    for (const s of readings(w.start)) pairs.push({ startMin: s, endMin: s + sessionMinutes });
  } else {
    // "3 to 4 pm": both readings of 3 are tried; a 13-hour session is not a session, so 3 PM is the one left.
    for (const s of readings(w.start)) {
      for (const e0 of readings(w.end)) {
        let e = e0;
        if (e <= s && !w.end.meridiem && e + 12 * 60 > s) e += 12 * 60;
        if (e > s) pairs.push({ startMin: s, endMin: e });
      }
    }
  }
  const valid = pairs.filter((p) => p.endMin - p.startMin >= PAST_SESSION_LIMITS.minMinutes && p.endMin - p.startMin <= PAST_SESSION_LIMITS.maxMinutes && p.endMin <= 24 * 60);
  if (valid.length === 0) return { problem: "Those times don't make a session. Try \"from 3 to 4\"." };
  const done = valid.filter((p) => p.endMin <= nowMin).sort((a, b) => b.endMin - a.endMin);
  if (done.length > 0) return done[0];
  if (valid.some((p) => p.startMin <= nowMin)) return { problem: NOT_FINISHED };
  return { problem: NOT_TODAY_FUTURE };
}

// "3:00-4:00 PM", "11:30 AM-12:30 PM".
export function timeRangeLabel(startMin: number, endMin: number): string {
  const part = (min: number) => {
    const h24 = Math.floor(min / 60) % 24;
    const mm = String(min % 60).padStart(2, "0");
    return { text: `${h24 % 12 === 0 ? 12 : h24 % 12}:${mm}`, mer: h24 < 12 ? "AM" : "PM" };
  };
  const a = part(startMin);
  const b = part(endMin);
  return a.mer === b.mer ? `${a.text}-${b.text} ${b.mer}` : `${a.text} ${a.mer}-${b.text} ${b.mer}`;
}

// ---- the name ----

export interface NamedClient {
  id: string;
  fullName: string;
  groupId?: string;
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The one client the name means, or every client it could mean (asked about), or none. Full name first, then first name, then a first name and the start of a last name ("sarah s").
export function matchClientByName(name: string, roster: NamedClient[]): { client: NamedClient } | { many: NamedClient[] } | { none: true } {
  const want = normName(name);
  if (!want) return { none: true };
  const people = new Map<string, NamedClient>();
  for (const c of roster) if (!people.has(c.id) && c.fullName) people.set(c.id, c);
  const all = Array.from(people.values());
  const pick = (test: (full: string, words: string[]) => boolean) => all.filter((c) => test(normName(c.fullName), normName(c.fullName).split(" ")));
  const wantWords = want.split(" ");
  const tiers = [
    pick((full) => full === want),
    pick((_, words) => wantWords.length === 1 && words[0] === want),
    pick((_, words) => wantWords.length >= 2 && words[0] === wantWords[0] && words.slice(1).join(" ").startsWith(wantWords.slice(1).join(" "))),
    pick((_, words) => wantWords.length === 1 && words.includes(want)),
  ];
  for (const found of tiers) {
    if (found.length === 1) return { client: found[0] };
    if (found.length > 1) return { many: found };
  }
  return { none: true };
}
