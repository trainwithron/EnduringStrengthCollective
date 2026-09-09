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

// Either a coach thinks in a plain day count ("3 days before"), or in a
// specific weekday ("the Friday before") — some coaches have a
// designated admin day of the week and want reminders anchored to that,
// not an arbitrary number.
export type ReminderRule =
  | { mode: "days_before"; days: number }
  | { mode: "weekday_before"; weekday: number }; // 0=Sun..6=Sat

// The actual calendar date a reminder rule resolves to for a given
// deadline — the single place both suggestion-activity and the
// auto-add-to-calendar date share, so they can never disagree.
function resolveReminderDate(deadline: Date, rule: ReminderRule): Date {
  if (rule.mode === "days_before") {
    const d = new Date(deadline);
    d.setDate(d.getDate() - rule.days);
    return startOfDay(d);
  }
  // weekday_before: the most recent occurrence of `weekday` strictly
  // before the deadline — always steps back at least 1 day, up to 7, so
  // a deadline that itself falls on the target weekday still gets a
  // full week's notice rather than firing same-day.
  const d = startOfDay(deadline);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() !== rule.weekday);
  return d;
}

// Active from the resolved reminder date through the end date itself
// (inclusive) — once the end date has passed without action, this stops
// suggesting it (a missed window, not a nagging one).
export function computeProgramEndingSuggestions(
  athletes: AthleteProgramInfo[],
  today: Date,
  rule: ReminderRule
): ProgramEndingSuggestion[] {
  const suggestions: ProgramEndingSuggestion[] = [];
  const todayStart = startOfDay(today);

  for (const athlete of athletes) {
    if (!athlete.programEndDate) continue;
    const reminderDate = resolveReminderDate(athlete.programEndDate, rule);
    const endDateStart = startOfDay(athlete.programEndDate);
    if (todayStart < reminderDate || todayStart > endDateStart) continue;
    const daysUntilEnd = daysBetween(today, athlete.programEndDate);

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

// Where an auto-added (or one-click-added) reminder should land, per the
// coach's own rule (a plain day count, or a specific weekday). Falls back
// to today if that date has already passed (the coach acted partway
// through the window).
export function computeSuggestedReminderDate(
  programEndDate: Date,
  rule: ReminderRule,
  today: Date
): Date {
  const target = resolveReminderDate(programEndDate, rule);
  return target < startOfDay(today) ? startOfDay(today) : target;
}
