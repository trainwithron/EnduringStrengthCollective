// "Time to progress?" (docs/TIME_TO_PROGRESS_DESIGN.md, Ron Oct 6). Pure logic, no database and no AI, in the style of lib/matched-load-trend.ts.
//
// The idea: when a client's main lifts have sat at the same load and reps for several sessions, ask the COACH, softly, whether they noticed. Nothing here is
// automatic to a client, nothing changes in a program without the coach tapping Apply, and no number is a rule: they are rough guidelines the coach can change.
// People do not progress every week, and a week with no change is never failure. The wording is always neutral (never "stalled", "plateau" or "stuck").

export const DEFAULT_THRESHOLD = 3;
export const MAX_LEARNED_THRESHOLD = 6;
const DAY = 86400000;

export type Tier = "A" | "B" | "C";

// One session of one exercise: the heaviest completed set that day.
export interface ProgressPoint {
  date: string;
  weight: number;
  reps: number;
  rpe: number | null;
  // True when a set that day was skipped or finished short of its target. A missed set is information (where did it break?), not a reason to ask
  // "time to progress?", so any such session means no card.
  missed: boolean;
}

export interface ExerciseHistory {
  exerciseName: string;
  tier: Tier | null;
  // Oldest first.
  points: ProgressPoint[];
  // The program's own target weight for the next time this exercise comes up; when it is already higher, the program is raising it (a progression model
  // already handles it) and nothing is shown.
  nextTargetWeight: number | null;
  // The program's rep target on the most recent session, as a number, for the optional rough-guide hint.
  lastTargetReps: number | null;
}

export type EffortTrend = "none" | "flat" | "settled" | "falling";

export interface ExerciseLook {
  exerciseName: string;
  isMain: boolean;
  sessions: number;
  weight: number;
  reps: number;
  spanDays: number;
  effort: EffortTrend;
  rpes: number[];
  // The common rule of thumb: 1 or 2 reps over target on two sessions in a row suggests a little more load. One hint among the rest, never a trigger.
  overTargetHint: boolean;
}

// The coach decides what a main lift is: by default the exercises tagged tier A or B in the exercise library.
export function isMainLift(tier: Tier | null): boolean {
  return tier === "A" || tier === "B";
}

export function mentionsPain(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(pain|painful|hurt|hurts|hurting|injur\w*|strain\w*|sprain\w*|tweak\w*|pulled|torn|tear|numb\w*|tingl\w*|swell\w*|aching|ache)\b/i.test(text);
}

// The most recent run of sessions (at least `threshold` of them) at exactly the same top load and reps, or null when the exercise is moving, or a set was
// missed, or the program is already raising it, or the effort is climbing (that is the fatigue watcher's job, not this one's).
export function lookAtExercise(h: ExerciseHistory, threshold: number, hintEnabled: boolean): ExerciseLook | null {
  const pts = h.points;
  if (threshold < 1 || pts.length < threshold) return null;
  const last = pts[pts.length - 1];
  let run = 0;
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (p.weight === last.weight && p.reps === last.reps) run++;
    else break;
  }
  if (run < threshold) return null;
  const recent = pts.slice(pts.length - run);
  if (recent.some((p) => p.missed)) return null;
  if (h.nextTargetWeight != null && h.nextTargetWeight > last.weight) return null;

  const rpes = recent.map((p) => p.rpe).filter((r): r is number => r != null);
  let effort: EffortTrend = "none";
  if (rpes.length >= 2) {
    const delta = rpes[rpes.length - 1] - rpes[0];
    if (delta >= 1) return null;
    if (delta <= -1) effort = "falling";
    else effort = rpes[rpes.length - 1] <= 7.5 ? "settled" : "flat";
  }
  const spanDays = Math.round((new Date(last.date).getTime() - new Date(recent[0].date).getTime()) / DAY);
  const over = h.lastTargetReps != null ? last.reps - h.lastTargetReps : 0;
  return {
    exerciseName: h.exerciseName,
    isMain: isMainLift(h.tier),
    sessions: run,
    weight: last.weight,
    reps: last.reps,
    spanDays,
    effort,
    rpes,
    overTargetHint: hintEnabled && run >= 2 && over >= 1 && over <= 2,
  };
}

export interface WorkoutInput {
  key: string;
  athleteId: string;
  groupId: string;
  title: string;
  lastSessionAt: string;
  histories: ExerciseHistory[];
}

export interface ProgressCard {
  key: string;
  athleteId: string;
  groupId: string;
  title: string;
  kind: "main" | "accessory";
  flagged: ExerciseLook[];
  // Other things that look odd inside the same workout (main card only).
  others: ExerciseLook[];
  lastSessionAt: string;
  // The date of the oldest session in the flat run, used to show the oldest evidence first.
  evidenceAt: string;
}

// A card points at the WORKOUT, not one lift. The main card comes from the main lifts; the accessory card is separate and comes a week later: it is only
// made when the main lifts are moving and the accessories have been flat for at least two weeks.
export function buildCards(w: WorkoutInput, threshold: number, hintEnabled: boolean): ProgressCard[] {
  const looks = w.histories.map((h) => ({ h, look: lookAtExercise(h, threshold, hintEnabled) }));
  const mainFlagged = looks.filter((l) => l.look && l.look.isMain).map((l) => l.look as ExerciseLook);
  const accessoryFlat = looks.filter((l) => l.look && !l.look.isMain).map((l) => l.look as ExerciseLook);
  const evidenceOf = (ls: ExerciseLook[]) => {
    const oldestSpan = Math.max(...ls.map((l) => l.spanDays));
    return new Date(new Date(w.lastSessionAt).getTime() - oldestSpan * DAY).toISOString();
  };
  const out: ProgressCard[] = [];
  if (mainFlagged.length > 0) {
    out.push({ key: `${w.key}::main`, athleteId: w.athleteId, groupId: w.groupId, title: w.title, kind: "main", flagged: mainFlagged, others: accessoryFlat, lastSessionAt: w.lastSessionAt, evidenceAt: evidenceOf(mainFlagged) });
    return out;
  }
  const mainsMoving = looks.some((l) => l.h.tier && isMainLift(l.h.tier) && !l.look && l.h.points.length >= threshold && !l.h.points.slice(-threshold).some((p) => p.missed));
  const slowAccessories = accessoryFlat.filter((l) => l.spanDays >= 14);
  if (mainsMoving && slowAccessories.length > 0) {
    out.push({ key: `${w.key}::accessory`, athleteId: w.athleteId, groupId: w.groupId, title: w.title, kind: "accessory", flagged: slowAccessories, others: [], lastSessionAt: w.lastSessionAt, evidenceAt: evidenceOf(slowAccessories) });
  }
  return out;
}

export const MAX_CARDS_SHOWN = 3;

// Oldest evidence first; one collapsed row counts them all, and at most three open at a time.
export function collapseCards(cards: ProgressCard[]): { count: number; shown: ProgressCard[] } {
  const sorted = [...cards].sort((a, b) => new Date(a.evidenceAt).getTime() - new Date(b.evidenceAt).getTime() || a.key.localeCompare(b.key));
  return { count: sorted.length, shown: sorted.slice(0, MAX_CARDS_SHOWN) };
}

// ---- Learning, per coach: kept in the coach's own feedback rows (spotter_recommendation_feedback, kind "progress"), no new table ----

export interface ProgressEvent {
  key: string;
  action: "confirmed" | "denied" | "edited";
  detail: string | null;
  at: string;
}

export const DELIBERATE_PREFIX = "progress-deliberate::";
export const APPLIED_PREFIX = "progress-applied::";
export const LATER_PREFIX = "progress-later::";
export const THRESHOLD_KEY = "progress-threshold";
export const HINT_KEY = "progress-hint";
export const ASK_HELP_PREFIX = "progress-ask-help::";

export const cardKey = (athleteId: string, groupId: string, workoutKey: string, kind: "main" | "accessory") => `progress::${athleteId}::${groupId}::${workoutKey}::${kind}`;

function ordered(events: ProgressEvent[]): ProgressEvent[] {
  return [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// The number of same-load sessions before a card appears. Starts at 3. Each "Yes, deliberate" raises it by 1 (up to 6); each time an option is applied it
// goes down by 1 (back to 3 at the lowest). A coach who changes it by hand sets it to what they chose (2 to 8), and the learning carries on from there.
export function progressThreshold(events: ProgressEvent[]): number {
  let n = DEFAULT_THRESHOLD;
  for (const e of ordered(events)) {
    if (e.key === THRESHOLD_KEY && e.action === "edited") {
      const v = Math.round(Number(e.detail));
      if (Number.isFinite(v)) n = Math.min(8, Math.max(2, v));
    } else if (e.key.startsWith(DELIBERATE_PREFIX)) {
      n = Math.min(Math.max(MAX_LEARNED_THRESHOLD, n), n + 1);
    } else if (e.key.startsWith(APPLIED_PREFIX)) {
      n = Math.max(Math.min(DEFAULT_THRESHOLD, n), n - 1);
    }
  }
  return n;
}

// The rough-guide hint is on unless the coach switched it off (the latest choice wins).
export function hintEnabled(events: ProgressEvent[]): boolean {
  const last = ordered(events).filter((e) => e.key === HINT_KEY).pop();
  return !(last && last.detail === "off");
}

export const DELIBERATE_DAYS = 42;
export const NOT_NOW_DAYS = 14;
export const AFTER_APPLY_DAYS = 14;

// When a card for this workout may come back, from the coach's own answers about THIS workout: "Yes, deliberate" keeps it quiet for 6 weeks, "Not now" and
// "look again in 2 weeks" for 2 weeks, and applying an option gives the change 2 weeks to show.
export function hiddenUntil(key: string, events: ProgressEvent[]): Date | null {
  const own = ordered(events).filter((e) => e.key === key || e.key === DELIBERATE_PREFIX + key || e.key === APPLIED_PREFIX + key || e.key === LATER_PREFIX + key);
  const last = own.pop();
  if (!last) return null;
  const days = last.key.startsWith(DELIBERATE_PREFIX) ? DELIBERATE_DAYS : last.key.startsWith(APPLIED_PREFIX) ? AFTER_APPLY_DAYS : NOT_NOW_DAYS;
  return new Date(new Date(last.at).getTime() + days * DAY);
}

export function isHidden(key: string, events: ProgressEvent[], now: Date): boolean {
  const until = hiddenUntil(key, events);
  return !!until && until.getTime() > now.getTime();
}

// ---- Words ----

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

// "Back squat 225 × 5 for the last 4 sessions, and the effort has come down (8, then 7, then 7)." Neutral, plain.
export function describeLook(l: ExerciseLook): string {
  const base = `${l.exerciseName} ${fmt(l.weight)} × ${l.reps} for the last ${l.sessions} sessions`;
  let tail = ".";
  if (l.effort === "falling") tail = `, and the effort has come down (${l.rpes.map(fmt).join(", then ")}). Same weight at lower effort is getting stronger.`;
  else if (l.effort === "settled") tail = `, with the effort settling around ${fmt(l.rpes[l.rpes.length - 1])}.`;
  else if (l.effort === "flat") tail = `, at about the same effort (${l.rpes.map(fmt).join(", ")}).`;
  const hint = l.overTargetHint ? " A rough guide: a rep or two over target twice in a row can mean a little more load is ready." : "";
  return base + tail + hint;
}

export function cardHeadline(card: ProgressCard, clientName: string): string {
  return card.kind === "accessory"
    ? `${clientName}'s main lifts are moving in ${card.title}; the accessories haven't.`
    : `${clientName}'s ${card.title}.`;
}

export interface OptionDraft {
  id: string;
  label: string;
  // "load" / "reps" / "set" change a number in the client's next workout; "note" adds the text to that exercise's coaching notes; "later" and "own" are not edits.
  kind: "load" | "reps" | "set" | "note" | "later" | "own";
  draft: string;
  amount?: number;
}

// A small, rough load step (about 2.5%, in steps of 2.5) as a starting draft the coach edits. Never a rule.
export function suggestedLoadStep(weight: number): number {
  const raw = weight * 0.025;
  return Math.max(2.5, Math.round(raw / 2.5) * 2.5);
}

// Progress is not only more weight: the list is wide on purpose. Every option is an editable draft; nothing is written until the coach taps Apply.
export function buildOptions(look: ExerciseLook, harderVariation: string | null): OptionDraft[] {
  const step = suggestedLoadStep(look.weight);
  return [
    { id: "load", label: "A little more load", kind: "load", draft: `+${fmt(step)}`, amount: step },
    { id: "reps", label: "One more rep", kind: "reps", draft: "+1", amount: 1 },
    { id: "set", label: "One more set", kind: "set", draft: "+1", amount: 1 },
    { id: "eccentric", label: "A slower lowering phase", kind: "note", draft: "Lower for 2 seconds on every rep (add a second or more)." },
    { id: "pause", label: "A pause at the bottom", kind: "note", draft: "Pause for 1 second at the bottom of every rep." },
    { id: "tempo", label: "A slower tempo", kind: "note", draft: "Slower tempo: 3 seconds down, 1 second up." },
    { id: "rom", label: "More range of motion", kind: "note", draft: "Go a little deeper if it stays comfortable." },
    { id: "variation", label: "A harder variation", kind: "note", draft: harderVariation ? `Try a harder variation: ${harderVariation}.` : "Try the next harder variation of this exercise." },
    { id: "control", label: "Better control", kind: "note", draft: "Same weight; own every rep (smooth and in control)." },
    { id: "effort", label: "The same load at lower effort", kind: "note", draft: "Keep the weight and aim for an easier effort, about a 6 or 7." },
    { id: "later", label: "Keep it, and look again in 2 weeks", kind: "later", draft: "" },
    { id: "own", label: "Change it only in this client's own program", kind: "own", draft: "" },
  ];
}

// An optional status note, in the coach's own voice, for the coach to edit and send. Never sent by itself, never "stalled", "plateau" or "stuck".
export function buildStatusNote(input: { firstName: string; effort: EffortTrend }): string {
  const name = input.firstName.trim() || "there";
  const lead = input.effort === "falling" || input.effort === "settled"
    ? "Your numbers are holding, and that is fine: the same weight at lower effort means you are getting stronger. We'll go up when it feels like a 6 or 7."
    : "Your numbers are holding steady, and that is fine. We'll go up when it feels right.";
  return `Hi ${name}, everything is going well. ${lead} If you'd like a call this week, just reply here and I'll set one up. If I feel we should talk, I'll reach out first.`;
}

export const HELP_QUESTION = "What do you feel you need the most help with right now? Where do you feel you're lacking? There's no wrong answer; I'd like to hear it in your words.";

export function buildHelpQuestionDraft(firstName: string): string {
  const name = firstName.trim() || "there";
  return `Hi ${name}, ${HELP_QUESTION.charAt(0).toLowerCase()}${HELP_QUESTION.slice(1)}`;
}
