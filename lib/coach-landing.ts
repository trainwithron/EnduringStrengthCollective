import { chooseActiveAnchor } from "@/lib/active-anchor";
import type { CoachedGroup } from "@/lib/coach-groups";

// Where a coach on a PHONE lands after signing in. Until now it was always their own client app (their personal space). A coach whose organization is a TEAM organization (every group a team-sport group) lands on that
// organization's coach home instead: the active program, the team, one More tools. Everyone else keeps landing on their own client app. With several organizations and none chosen, and at least one of them a team organization,
// the coach is asked which one first (one plain screen). Pure, so it is tested with the real shapes (three organizations with one team group each, a personal space that belongs to no organization).
export type PhoneLanding = { to: "own" } | { to: "choose" } | { to: "coach-home"; groupId: string };

export function coachPhoneLanding(groups: CoachedGroup[], rememberedGroupId: string | null | undefined, teamOnlyOrgIds: ReadonlySet<string>): PhoneLanding {
  if (groups.length === 0 || teamOnlyOrgIds.size === 0) return { to: "own" };
  const chosen = chooseActiveAnchor(groups, rememberedGroupId);
  if (!chosen) return { to: "own" };
  if (chosen.needsChoice) return { to: "choose" };
  return teamOnlyOrgIds.has(chosen.orgId) ? { to: "coach-home", groupId: chosen.anchor.id } : { to: "own" };
}

/** The organizations whose every coached group is a team-sport group (needs team_mode for each coached group id). */
export function teamOnlyOrgs(groups: CoachedGroup[], teamModeByGroup: ReadonlyMap<string, boolean | null>): Set<string> {
  const out = new Set<string>();
  const orgIds = new Set(groups.map((g) => g.orgId));
  for (const orgId of orgIds) {
    const inOrg = groups.filter((g) => g.orgId === orgId);
    if (inOrg.length > 0 && inOrg.every((g) => teamModeByGroup.get(g.id) === true)) out.add(orgId);
  }
  return out;
}
