// Milestone Celebrations, piece D (milestone_celebration_system_scoping.md)
// — "your journey so far," an always-available evergreen recap. Unlike
// every other piece in this thread, this isn't trend- or threshold-
// triggered at all — it's on-demand, computed live from whatever real
// history already exists. These are the small pure-formatting helpers;
// the actual data assembly lives in lib/journey-recap-data.ts (needs a
// database client, so it's kept separate from this pure module, same
// split already used elsewhere in this app).

// A human-scaled "how long have you been at this" label — picks the
// coarsest unit that still reads as a real number (not "0 months" for a
// 3-week-old account, not "84 days" for a 3-year veteran).
export function formatJourneyDuration(startDate: Date, asOf: Date): string {
  const days = Math.max(0, Math.round((asOf.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} year${years === 1 ? "" : "s"}`;
}

// Deliberately reports only the DELTA, never either absolute weight —
// same privacy restraint already applied to the relative-strength and
// reverse-diet milestones (a change number doesn't disclose what either
// endpoint actually was).
export function formatWeightChange(deltaLbs: number): string {
  const rounded = Math.round(Math.abs(deltaLbs) * 10) / 10;
  if (rounded < 1) return "holding steady";
  return deltaLbs < 0 ? `down ${rounded} lbs` : `up ${rounded} lbs`;
}
