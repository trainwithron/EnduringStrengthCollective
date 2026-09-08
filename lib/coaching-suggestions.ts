// Pure logic for "needs attention" coaching suggestions — e.g. an
// athlete's program is ending soon and needs their next one assigned.
// No DB access; the caller supplies each athlete's computed program end
// date (from lib/program-schedule.ts's computeScheduledDates) and gets
// back which ones are currently worth surfacing.

export interface AthleteProgramInfo {
  athleteId: string;
  athleteName: string;
  groupId: string;
  groupName: string;
  programEndDate: Date | null; // last scheduled date of their active program, or null if unscheduled
}

export interface ProgramEndingSuggestion {
  athleteId: string;
  athleteName: string;
  groupId: string;
  groupName: string;
  programEndDate: Date;
  daysUntilEnd: number;
  title: string;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / msPerDay);
}

// Active from `leadDays` before the end date through the end date itself
// (inclusive) — once the end date has passed without action, this stops
// suggesting it (a missed window, not a nagging one).
export function computeProgramEndingSuggestions(
  athletes: AthleteProgramInfo[],
  today: Date,
  leadDays: number
): ProgramEndingSuggestion[] {
  const suggestions: ProgramEndingSuggestion[] = [];

  for (const athlete of athletes) {
    if (!athlete.programEndDate) continue;
    const daysUntilEnd = daysBetween(today, athlete.programEndDate);
    if (daysUntilEnd < 0 || daysUntilEnd > leadDays) continue;

    suggestions.push({
      athleteId: athlete.athleteId,
      athleteName: athlete.athleteName,
      groupId: athlete.groupId,
      groupName: athlete.groupName,
      programEndDate: athlete.programEndDate,
      daysUntilEnd,
      title:
        daysUntilEnd === 0
          ? `${athlete.athleteName}'s program ends today — assign their next one`
          : `${athlete.athleteName}'s program ends in ${daysUntilEnd} day${daysUntilEnd === 1 ? "" : "s"} — assign their next one`,
    });
  }

  return suggestions.sort((a, b) => a.daysUntilEnd - b.daysUntilEnd);
}

export interface AthleteMacroInfo {
  athleteId: string;
  athleteName: string;
  groupId: string;
  groupName: string;
  clientTier: "one_on_one" | "online" | "group" | null;
  daysWithMacrosNextWeek: number; // how many of the next 7 days already have a target set
}

export interface MacrosMissingSuggestion {
  athleteId: string;
  groupId: string;
  groupName: string;
  title: string;
}

// Group-tier clients don't get macro programming at all (not part of what
// they pay for) — never suggested for them regardless of what's set.
export function computeMacrosMissingSuggestions(
  athletes: AthleteMacroInfo[]
): MacrosMissingSuggestion[] {
  return athletes
    .filter((a) => a.clientTier !== "group" && a.daysWithMacrosNextWeek === 0)
    .map((a) => ({
      athleteId: a.athleteId,
      groupId: a.groupId,
      groupName: a.groupName,
      title: `${a.athleteName} has no macros set for next week`,
    }));
}

// Where an auto-added (or one-click-added) reminder should land: lead
// days before the end date, e.g. a Friday end with a 3-day lead lands on
// Tuesday — matching "prompt me Tuesday/Wednesday/Thursday" for a Friday
// deadline. Falls back to today if that date has already passed (the
// coach acted partway through the window).
export function computeSuggestedReminderDate(
  programEndDate: Date,
  leadDays: number,
  today: Date
): Date {
  const target = new Date(programEndDate);
  target.setDate(target.getDate() - leadDays);
  return startOfDay(target) < startOfDay(today) ? startOfDay(today) : startOfDay(target);
}
