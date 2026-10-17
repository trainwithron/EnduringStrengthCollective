// The rules for a coach who is leaving (Ron, Oct 17). Pure: the daily job and the screens both read them from here.
//   QUIT (they left, or the owner said they are leaving on good terms): seven days of coaching access as before, a notice the day they are marked, reminders with three days and with one day left; at day
//     seven coaching access ends. Choosing "start my own account" before then moves their clients and everything into an account they own (standard free trial) and stops the clock.
//   FIRED (the owner said they are being let go): coaching access ends at once and they cannot start an account here (a platform administrator can lift that).
// Either way nothing is deleted: the clients, their records and history stay where they are, and the coach gets ONE export of the clients they kept, by an emailed link that needs sign-in and works for EXPORT_LINK_DAYS.
export const WINDOW_DAYS = 7; // mirrored by end_departure_access() in migration 0396
export const REMINDER_DAYS_LEFT = [3, 1] as const;
export const EXPORT_LINK_DAYS = 30;
export const DEFAULT_RETENTION_DAYS = 365;

const DAY_MS = 86_400_000;

// How long the preserved records are kept before anyone may delete them (and only after a snapshot). A lawyer sets the real number (docs/NEEDS_RON.md); until then 365.
export function retentionDays(env: string | undefined = process.env.RETENTION_DAYS): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

export interface DepartureRow {
  departingSince: string;
  firedAt: string | null;
  accessEndedAt: string | null;
  departureNotifiedAt: string | null;
  reminded3dAt: string | null;
  reminded1dAt: string | null;
  closureNotifiedAt: string | null;
}

export const windowEndsAt = (departingSince: string): Date => new Date(new Date(departingSince).getTime() + WINDOW_DAYS * DAY_MS);

// Whole days left to choose, rounded up (never below 0).
export function daysLeftToChoose(departingSince: string, now: Date): number {
  return Math.max(0, Math.ceil((windowEndsAt(departingSince).getTime() - now.getTime()) / DAY_MS));
}

export interface DeparturePlan {
  tellThemTheyAreLeaving: boolean;
  remind3: boolean;
  remind1: boolean;
  endAccess: boolean;
  closure: boolean; // the export link to the coach, and the notice to their clients
}

// What the job should do for one coach right now. Each step is sent once (its own timestamp), and a step never repeats.
export function departurePlan(row: DepartureRow, now: Date): DeparturePlan {
  const left = windowEndsAt(row.departingSince).getTime() - now.getTime();
  const ended = !!row.accessEndedAt;
  const windowOver = left <= 0;
  const quitting = !row.firedAt && !ended;
  return {
    tellThemTheyAreLeaving: quitting && !row.departureNotifiedAt,
    remind3: quitting && !windowOver && !row.reminded3dAt && left <= REMINDER_DAYS_LEFT[0] * DAY_MS,
    remind1: quitting && !windowOver && !row.reminded1dAt && left <= REMINDER_DAYS_LEFT[1] * DAY_MS,
    endAccess: quitting && windowOver,
    closure: (ended || (quitting && windowOver)) && !row.closureNotifiedAt,
  };
}

// The emailed export link stops working this long after access ended.
export const exportLinkExpiresAt = (accessEndedAt: string): Date => new Date(new Date(accessEndedAt).getTime() + EXPORT_LINK_DAYS * DAY_MS);
export const exportLinkStillWorks = (accessEndedAt: string | null, now: Date): boolean => !!accessEndedAt && now < exportLinkExpiresAt(accessEndedAt);
