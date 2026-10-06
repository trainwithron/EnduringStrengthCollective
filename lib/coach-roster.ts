import type { RosterMember } from "@/lib/types";
import type { GroupKind } from "@/lib/coach-groups";

// The phone Clients list is coach-level: every client across the groups the coach coaches in this organization, whichever group
// the coach last looked at. A client who is in more than one group is listed once. They are opened in their one-on-one group when
// they have one (that is where their sessions and balance are kept), and their last workout is the latest one in ANY of those groups.

export interface RosterRowAcrossGroups {
  groupId: string;
  groupKind: GroupKind;
  member: RosterMember;
}

const KIND_RANK: Record<GroupKind, number> = { one_on_one: 0, team: 1, social: 2 };

export function mergeRosterAcrossGroups(rows: RosterRowAcrossGroups[]): RosterMember[] {
  const byProfile = new Map<string, { best: RosterRowAcrossGroups; lastWorkoutAt: string | null }>();
  for (const row of rows) {
    const existing = byProfile.get(row.member.profileId);
    const last = row.member.lastWorkoutAt;
    if (!existing) {
      byProfile.set(row.member.profileId, { best: row, lastWorkoutAt: last });
      continue;
    }
    if (last && (!existing.lastWorkoutAt || last > existing.lastWorkoutAt)) existing.lastWorkoutAt = last;
    if (KIND_RANK[row.groupKind] < KIND_RANK[existing.best.groupKind]) existing.best = row;
  }
  return [...byProfile.values()]
    .map(({ best, lastWorkoutAt }) => ({ ...best.member, groupId: best.groupId, lastWorkoutAt }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
