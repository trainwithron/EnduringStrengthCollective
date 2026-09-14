// Real adherence-days computation from food_log_entries — replaces the
// weekly check-in's old plain manual 1-7 entry (see
// weekly-checkin-panel.tsx, which had "no per-meal food logging in this
// app to derive it from" before this). A day counts as adherent if the
// athlete logged anything that day other than a skip — matches this
// app's own "checkoff, not accuracy" philosophy: the point is whether
// they engaged with the plan, not whether every gram was exact.
export function computeAdherenceDays(
  entryDateKeys: string[],
  todayKey: string,
  windowDays = 7
): number {
  const days = new Set<string>();
  const today = new Date(`${todayKey}T00:00:00`);
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.add(d.toISOString().slice(0, 10));
  }
  const loggedDays = new Set(entryDateKeys.filter((k) => days.has(k)));
  return loggedDays.size;
}
