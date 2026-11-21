import { attentionHeadline } from "@/lib/your-day";
import { greetingFirstName } from "@/lib/first-name";

// Home's greeting band (Look Refresh, Ron Nov 20): the words at the top of Home, from what the page already has. All in the coach's own time zone.

// The Pulse "need attention" list on Home. A link to it (the greeting band's "N could use a check-in", the Need attention and At-risk tiles) opens the list, not just scrolls to it (audit, Nov 21).
export const PULSE_ATTENTION_ANCHOR = "pulse-attention";
export const PULSE_ATTENTION_HREF = `#${PULSE_ATTENTION_ANCHOR}`;

export function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function dateLabelFor(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
}

/** "Ron" from "Ron Arnold" or "Coach Ron" (Ron, Nov 20: the band read "Good afternoon, Coach"); a name-less coach is greeted without one. */
export function greetingTitle(greeting: string, fullName: string | null | undefined): string {
  const first = greetingFirstName(fullName);
  return first ? `${greeting}, ${first}` : greeting;
}

/** "Nothing on the calendar today. 6 things need you." */
export function daySummary(onCalendar: number, needYou: number): string {
  const calendar = onCalendar === 0 ? "Nothing on the calendar today." : `${onCalendar} on the calendar today.`;
  return `${calendar} ${attentionHeadline(needYou)}.`;
}

/** The ring's numbers: how many of the clients trained this week, and the share as a whole percent. */
export function trainedThisWeek(active: number, total: number): { active: number; total: number; pct: number } {
  const safeTotal = Math.max(0, total);
  const safeActive = Math.max(0, Math.min(active, safeTotal));
  return { active: safeActive, total: safeTotal, pct: safeTotal === 0 ? 0 : Math.round((safeActive / safeTotal) * 100) };
}

// Wins (Look Refresh): clients who trained in the last few days, newest first, from the last-workout dates Home already reads for its client cards. No new read.
export interface WinRow {
  athleteId: string;
  groupId: string;
  fullName: string;
  line: string;
}

export function recentWins(
  clients: { athleteId: string; groupId: string; fullName: string; lastWorkoutAt: string | null }[],
  now: Date,
  timeZone: string,
  { max = 3, days = 3 }: { max?: number; days?: number } = {}
): WinRow[] {
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  const since = now.getTime() - days * 86400000;
  return clients
    .filter((c) => c.lastWorkoutAt && new Date(c.lastWorkoutAt).getTime() >= since && new Date(c.lastWorkoutAt).getTime() <= now.getTime())
    .sort((a, b) => String(b.lastWorkoutAt).localeCompare(String(a.lastWorkoutAt)))
    .slice(0, max)
    .map((c) => {
      const at = new Date(c.lastWorkoutAt as string);
      const key = dayKey(at);
      const line =
        key === today
          ? `${c.fullName} logged a workout today`
          : key === yesterday
            ? `${c.fullName} logged a workout yesterday`
            : `${c.fullName} trained ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at)}`;
      return { athleteId: c.athleteId, groupId: c.groupId, fullName: c.fullName, line };
    });
}
