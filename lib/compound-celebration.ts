// Milestone Celebrations, piece #1 (milestone_celebration_system_scoping.md)
// — the "everything's clicking" compound share card. Purely a
// presentation layer over three numbers this app already computes
// independently (habit compliance, PR count, consistency streak) — no
// new detection engine, no schema, no cron. Distinct from the PR-fatigue/
// baseline reframe (lib/pr-fatigue.ts) and the volume-equivalence joke —
// this celebrates several good things converging in the SAME window, not
// any one session's performance.

export interface CompoundCelebrationInputs {
  habitCompliancePct: number | null; // null = no active habits, not "0%"
  prCountThisMonth: number;
  weekStreak: number;
}

// Qualifying thresholds per signal — each is independently meaningful,
// not just "any nonzero number":
//   - habit compliance: a real majority of due habits actually done
//   - PRs: at least one genuine new record this month
//   - streak: the same >= 2 floor already used for the streak badge
//     elsewhere on this card (a first week isn't a "streak" yet)
const HABIT_COMPLIANCE_QUALIFY_PCT = 70;
const PR_COUNT_QUALIFY = 1;
const STREAK_QUALIFY_WEEKS = 2;

// "8-week" is spoken "eight-week" (vowel sound, needs "an"); "2-week" is
// spoken "two-week" (consonant sound, needs "a"). Only numbers that read
// as starting with "eight" or the two irregular teens do this in
// practice for a streak count.
function startsWithVowelSound(n: number): boolean {
  const s = String(Math.abs(n));
  if (s === "11" || s === "18") return true;
  return s[0] === "8";
}

export function isHabitComplianceQualifying(pct: number | null): boolean {
  return pct != null && pct >= HABIT_COMPLIANCE_QUALIFY_PCT;
}

export function isPrCountQualifying(count: number): boolean {
  return count >= PR_COUNT_QUALIFY;
}

export function isStreakQualifying(weeks: number): boolean {
  return weeks >= STREAK_QUALIFY_WEEKS;
}

// "Everything's clicking" implies more than one thing going well at
// once — a single qualifying signal alone is already celebrated
// elsewhere (the PR list, the streak badge), so this card only shows
// once at least two of the three independently clear their bar.
export function shouldShowCompoundCelebration(inputs: CompoundCelebrationInputs): boolean {
  const qualifyingCount = [
    isHabitComplianceQualifying(inputs.habitCompliancePct),
    isPrCountQualifying(inputs.prCountThisMonth),
    isStreakQualifying(inputs.weekStreak),
  ].filter(Boolean).length;
  return qualifyingCount >= 2;
}

// Composes only the qualifying clauses into one sentence — a signal that
// didn't clear its own bar (e.g. a 1-week streak) is left out entirely
// rather than dragging the sentence down with a weak number.
export function buildCompoundCelebrationText(inputs: CompoundCelebrationInputs): string {
  const clauses: string[] = [];
  if (isHabitComplianceQualifying(inputs.habitCompliancePct)) {
    clauses.push(`${inputs.habitCompliancePct}% habit compliance`);
  }
  if (isPrCountQualifying(inputs.prCountThisMonth)) {
    clauses.push(`${inputs.prCountThisMonth} new PR${inputs.prCountThisMonth === 1 ? "" : "s"}`);
  }
  if (isStreakQualifying(inputs.weekStreak)) {
    clauses.push(`${startsWithVowelSound(inputs.weekStreak) ? "an" : "a"} ${inputs.weekStreak}-week streak`);
  }
  const joined =
    clauses.length <= 1
      ? clauses.join("")
      : clauses.length === 2
      ? clauses.join(" and ")
      : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
  return `${joined} — this is what showing up looks like.`;
}
