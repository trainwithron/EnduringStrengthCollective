// Shared "pinned-to-top, full-list-below" sort — the same rule
// (home_dashboard_merge_and_pulse_tabs_redesign.md) confirmed for both
// the desktop Client Pulse / Group Pulse tabs and, later, the
// not-yet-built mobile Roster A-Z redesign (coach_mobile_v2_feature_spec.md).
// A stable partition, not a full re-sort: pinned items keep whatever
// relative order they already had among themselves, and so does
// everything else — this only decides which half of the list an item
// lands in, never how items compare within a half.
export function sortPulseFirst<T>(items: T[], isPinned: (item: T) => boolean): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (isPinned(item) ? pinned : rest).push(item);
  }
  return [...pinned, ...rest];
}
