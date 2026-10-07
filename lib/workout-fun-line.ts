import { getVolumeEquivalence } from "./volume-equivalence";
import { GYM_JOKES } from "./gym-jokes";
import { FAMOUS_QUOTE_LINES } from "./famous-quotes";
import { hashSeed, seededRandom } from "./seeded-pick";

// The one light line on the post-workout card. It is picked when the card is made, from three kinds that are spread out over time:
//   stat    a quip built from THIS workout's own numbers (pounds, minutes, sets, streak, PR)
//   equiv   "that's the weight of N grizzly bears" (a volume comparison)
//   absurd  a clean gym joke, an absurd line, or an unattributed quote
// A short, small or empty session gets an ENCOURAGING line instead (kind "encourage"), never a joke at its expense.
//
// Fresh, not stable: nothing here is seeded by the workout. The caller remembers the client's recent lines (`recent`, up to RECENT_WINDOW) and a line in that
// window is never picked again while there is anything else to pick; the kind with the fewest recent lines is the most likely, so the three kinds spread out.
// Randomness is injected (`rand`) so a test can drive it, and `seededRandom` gives the repeatable version used for the default a stranger sees.
//
// Rules every line follows (Ron's): clean and kind; never about the client's body, performance falling short, or appearance; no guilt; no real named people and no
// trademarks; short enough for the card's two-line clamp (MAX_FUN_LINE_CHARS). A number that is missing or too small to be worth saying is left out (the line falls
// back to one that does not need it) instead of printing a zero, "NaN" or "undefined".

export const MAX_FUN_LINE_CHARS = 110;
export const RECENT_WINDOW = 20;

export type FunKind = "stat" | "equiv" | "absurd" | "encourage";

export interface FunLine {
  id: string;
  kind: FunKind;
  text: string;
}

export interface WorkoutFacts {
  totalVolume: number | null;
  durationSeconds: number | null;
  totalSets: number | null;
  weekStreak: number;
  prCount: number;
  totalWorkoutCount: number | null;
}

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const good = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

// A stable id for a line made of plain text (so it can be remembered): the kind plus a short hash of the text. Editing a line's words makes it a new line.
export function lineId(kind: FunKind, text: string): string {
  return `${kind}:${hashSeed(text).toString(36)}`;
}

// "an hour", "an hour and 6 minutes", "2 hours and 5 minutes", "45 minutes".
export function durationInWords(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60));
  if (total < 60) return `${total} ${total === 1 ? "minute" : "minutes"}`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 1 ? "an hour" : `${h} hours`;
  return m === 0 ? hours : `${hours} and ${m} ${m === 1 ? "minute" : "minutes"}`;
}

// A volume worth saying out loud: real, at least 1,000 lbs, and not so large that it is almost certainly a typo set (a card that says "1,800,000 pounds moved"
// or "thirty thousand blue whales" would be posted publicly). Above the cap the volume-based lines are left out and the line falls back to ones that do not use it.
export const MAX_BELIEVABLE_VOLUME = 500_000;
function volumeOk(f: WorkoutFacts, min = 1000): f is WorkoutFacts & { totalVolume: number } {
  return good(f.totalVolume) && f.totalVolume >= min && f.totalVolume <= MAX_BELIEVABLE_VOLUME;
}

// A session length worth saying: 20 minutes to 2 hours. A timer left running (4 hours for a 40-minute session) must not turn into "only 3 hours and 40 minutes".
const MIN_TALK_SECONDS = 20 * 60;
const MAX_TALK_SECONDS = 120 * 60;
function durationOk(f: WorkoutFacts): f is WorkoutFacts & { durationSeconds: number } {
  return good(f.durationSeconds) && f.durationSeconds >= MIN_TALK_SECONDS && f.durationSeconds <= MAX_TALK_SECONDS;
}

// Pounds moved per minute, only when the volume and the time are both believable and the rate is high enough to be worth saying (not 8 pounds a minute).
const MIN_RATE_LB_PER_MIN = 25;
function poundsPerMinute(f: WorkoutFacts): number | null {
  if (!volumeOk(f, 2000) || !durationOk(f)) return null;
  const ppm = f.totalVolume / (f.durationSeconds / 60);
  return Number.isFinite(ppm) && ppm >= MIN_RATE_LB_PER_MIN ? ppm : null;
}

// A session too short or too empty for a joke: it gets an encouraging line (or a streak or PR line, which are always kind). Judged by sets and time ONLY. Volume
// says nothing about size: a 45-minute bodyweight circuit or a 60-minute run has no pounds at all and is a proper session. A lack of volume just means the
// volume-based lines are left out (see volumeOk).
export function isSmallSession(f: WorkoutFacts): boolean {
  if (good(f.durationSeconds) && f.durationSeconds < 10 * 60) return true;
  if (f.totalSets === 0) return true; // nothing completed: a check-in
  // One or two sets is small unless the session itself ran long (a 60-minute run is logged as one set).
  if (f.totalSets != null && f.totalSets < 3 && !(good(f.durationSeconds) && f.durationSeconds >= MIN_TALK_SECONDS)) return true;
  return false;
}

interface Template {
  key: string; // a stable name, the line's id
  needs: (f: WorkoutFacts) => boolean;
  text: (f: WorkoutFacts) => string;
}

// Lines built from this workout's own numbers. `key` is the line's identity, so the same template with different numbers is still the same line to remember.
export const STAT_QUIPS: Template[] = [
  {
    key: "money-rate",
    needs: (f) => poundsPerMinute(f) != null && good(f.totalVolume),
    text: (f) => `You lifted ${num(f.totalVolume as number)} pounds in ${(f.durationSeconds as number) <= 90 * 60 ? "only " : ""}${durationInWords(f.durationSeconds as number)}. Too bad we can't make money at that rate. 💸`,
  },
  {
    key: "per-minute",
    needs: (f) => poundsPerMinute(f) != null,
    text: (f) => `That's about ${num(poundsPerMinute(f) as number)} pounds moved every minute you were in there. ⚡`,
  },
  {
    key: "sets-promises",
    needs: (f) => good(f.totalSets) && f.totalSets >= 3,
    text: (f) => `${f.totalSets} sets, ${f.totalSets} promises kept. 🤝`,
  },
  {
    key: "sets-down",
    needs: (f) => good(f.totalSets) && f.totalSets >= 5,
    text: (f) => `${f.totalSets} sets down and not one excuse left standing. ✅`,
  },
  {
    key: "volume-floor",
    needs: (f) => volumeOk(f, 2000),
    text: (f) => `${num(f.totalVolume as number)} pounds moved today. The floor felt every one. 🏋️`,
  },
  {
    key: "time-and-pounds",
    needs: (f) => volumeOk(f, 2000) && durationOk(f),
    text: (f) => `${durationInWords(f.durationSeconds as number)}, ${num(f.totalVolume as number)} pounds. Time well spent. ⏱️`,
  },
  // Always-kind lines tied to a milestone this workout actually reached.
  { key: "streak-cheat-code", needs: (f) => f.weekStreak >= 2, text: (f) => `${f.weekStreak} weeks in a row. Consistency is the cheat code. 🔥` },
  { key: "streak-calendar", needs: (f) => f.weekStreak >= 2, text: (f) => `${f.weekStreak} straight weeks of showing up. Your calendar approves. 📅` },
  { key: "pr-retired", needs: (f) => f.prCount >= 1, text: () => "A new PR. The old number just retired. 🏆" },
  { key: "pr-notified", needs: (f) => f.prCount >= 1, text: () => "New personal record. The barbell has been notified. 🏆" },
  { key: "workout-count", needs: (f) => good(f.totalWorkoutCount) && f.totalWorkoutCount >= 10, text: (f) => `Workout #${f.totalWorkoutCount}. That is a lot of promises kept. 📈` },
];

// The milestone lines (streak, PR, workout count) are kind for any session, small or not.
const MILESTONE_KEYS = new Set(["streak-cheat-code", "streak-calendar", "pr-retired", "pr-notified", "workout-count"]);

// For a short, small or empty session, and the fallback when nothing else applies. Unattributed, no names.
export const ENCOURAGING_LINES: string[] = [
  "The hardest rep is the first one, and you did that. 💪",
  "Showing up counts, and you showed up. 🙌",
  "A short session beats a skipped one every time. ⏱️",
  "Small sessions add up. Nice work. 🌱",
  "You checked in. That is the habit that wins. ✅",
  "Every session is a vote for the person you are becoming. 🗳️",
];

// Short, unattributed lines about training in general.
export const QUOTES: string[] = [
  "Strength is built one set at a time. 🧱",
  "You do not have to be extreme, just consistent. 🔁",
  "Progress is quiet until it is obvious. 📈",
  "The work you do when no one is watching is the work that shows. 🌙",
  "Be patient with the process and ruthless with the habit. ⏳",
];

// The absurd bank. This is where the vetted batch of lines is loaded (plain strings, clean and kind, no real people or trademarks, 110 characters or fewer). Gym
// jokes and quotes are in it now; more lines only make a repeat rarer.
// Ron's own lines (his jokes, puns and parodies, approved word for word). They are the one place a named person, a first-person line or a skipped-leg-day joke is allowed, so
// the tests that ban those in the rest of the bank list these by exact text. Keep them as Ron wrote them; the Franklin Roosevelt line is deliberately straight.
export const RON_LINES: string[] = [
  "Two fish are in a tank. One says to the other: How do I drive this thing?",
  "Why couldn't the bicycle stand up by itself? It was two tired.",
  "What do you get when you cross an elephant and a rhinoceros? Ellifino.",
  "Two peanuts were walking down the road. One was a-salted.",
  "You just got rick-rolled by a dumbbell. Always gonna pick you up. - Rick Dumbbell-ley",
  "Never gonna let the bar down. Never gonna run around and skip leg day. - Rick Dumbbell-ley",
  "Give me liberty, or give me reps. - Patrick Henry, allegedly",
  "I think, therefore I am sore. - Descartes",
  "Someone rolled off the wrong side of the bench press this morning.",
  "The only thing we have to fear is fear itself. - Franklin D. Roosevelt",
];

export const ABSURD_LINES: string[] = [...GYM_JOKES, ...QUOTES, ...FAMOUS_QUOTE_LINES, ...RON_LINES];

const FITS = (s: string) => s.length <= MAX_FUN_LINE_CHARS;

// How many different volume comparisons to offer from one workout's pounds (each a different object).
const EQUIV_VARIANTS = 12;

// Every line this workout could show, with its kind and stable id. Exposed so a test can render every template at edge values.
export function funLinePool(f: WorkoutFacts): FunLine[] {
  const out: FunLine[] = [];
  const small = isSmallSession(f);

  for (const t of STAT_QUIPS) {
    if (small && !MILESTONE_KEYS.has(t.key)) continue;
    if (!t.needs(f)) continue;
    const text = t.text(f);
    if (FITS(text)) out.push({ id: `stat:${t.key}`, kind: "stat", text });
  }

  if (small) {
    for (const text of ENCOURAGING_LINES) if (FITS(text)) out.push({ id: lineId("encourage", text), kind: "encourage", text });
    return out;
  }

  if (volumeOk(f)) {
    const seen = new Set<string>();
    for (let i = 0; i < EQUIV_VARIANTS; i++) {
      const eq = getVolumeEquivalence(f.totalVolume, `variant-${i}`);
      if (eq && !seen.has(eq.id) && FITS(eq.text)) {
        seen.add(eq.id);
        out.push({ id: eq.id, kind: "equiv", text: eq.text });
      }
    }
  }

  for (const text of ABSURD_LINES) if (FITS(text)) out.push({ id: lineId("absurd", text), kind: "absurd", text });
  return out;
}

const NICE_WORK: FunLine = { id: "encourage:nice-work", kind: "encourage", text: "Nice work today. 💪" };

export interface RecentLine {
  id: string;
  kind: FunKind;
}

function randomOf<T>(items: T[], rand: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
}

// Picks a line for this workout that is not among the client's recent lines (at most RECENT_WINDOW, newest first or last: only membership matters, except for the
// all-used fallback below, which prefers the line seen longest ago, so `recent` is oldest-first). `avoid` adds ids to skip (the line on screen when the client taps
// "Another one"). The kind with the fewest recent lines is the most likely, so the kinds spread out. Always returns a line.
export function pickFreshFunLine(f: WorkoutFacts, recent: RecentLine[], rand: () => number = Math.random, avoid: string[] = []): FunLine {
  const pool = funLinePool(f);
  if (pool.length === 0) return NICE_WORK; // never empty today (the absurd bank is always there), but a pick must not crash if it ever is
  const window = recent.slice(-RECENT_WINDOW);
  const recentIds = new Set(window.map((r) => r.id));
  const blocked = new Set([...recentIds, ...avoid]);

  const fresh = pool.filter((l) => !blocked.has(l.id));
  if (fresh.length > 0) {
    const kinds = Array.from(new Set(fresh.map((l) => l.kind)));
    const weight = (k: FunKind) => 1 / (1 + window.filter((r) => r.kind === k).length);
    const total = kinds.reduce((a, k) => a + weight(k), 0);
    let roll = rand() * total;
    let kind = kinds[kinds.length - 1];
    for (const k of kinds) {
      roll -= weight(k);
      if (roll < 0) {
        kind = k;
        break;
      }
    }
    return randomOf(
      fresh.filter((l) => l.kind === kind),
      rand
    );
  }

  // Everything this workout could show was shown recently (a small session, or a small bank): take the line seen longest ago, never the one to avoid.
  const avoided = new Set(avoid);
  const choices = pool.filter((l) => !avoided.has(l.id));
  const usable = choices.length > 0 ? choices : pool;
  const lastSeen = (id: string) => window.map((r) => r.id).lastIndexOf(id);
  const oldest = Math.min(...usable.map((l) => lastSeen(l.id)));
  return randomOf(
    usable.filter((l) => lastSeen(l.id) === oldest),
    rand
  );
}

// The repeatable pick (same facts and seed, same line): what someone who is not the client sees, and the server's first render.
export function pickSeededFunLine(f: WorkoutFacts, seed: string): FunLine {
  return pickFreshFunLine(f, [], seededRandom(seed));
}

// "Another one": a different line from the one showing, still avoiding the recent window.
export function rerollFunLine(f: WorkoutFacts, recent: RecentLine[], currentId: string, rand: () => number = Math.random): FunLine {
  return pickFreshFunLine(f, recent, rand, [currentId]);
}
