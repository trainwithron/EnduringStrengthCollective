// social_only_group_membership_idea.md — the real cross-membership
// signal for whether an athlete's nav should show Feed/Social at all.
// Extracted as a pure function (not inlined in bottom-tab-bar.tsx) so
// the actual boolean logic is directly unit-testable — a true solo
// 1-on-1 client with no other membership can't be exercised by a real
// login in every test environment, but this can be checked exhaustively
// without one.
export interface MembershipForSocialAccess {
  membershipType: string | null;
  groupKind: string | null;
}

// A membership grants social access if it's either a genuine team/
// social group (group_kind other than 'one_on_one' — a null/legacy
// group_kind defaults to 'team', same fallback this app already uses
// elsewhere, e.g. coach-desktop-shell.tsx's own groupKind state) or is
// explicitly flagged membership_type = 'social_only'. A client with NO
// membership that satisfies either condition — e.g. a solo 1-on-1
// client whose only row is their own private training group — gets no
// Social tab at all.
export function hasSocialTabAccess(memberships: MembershipForSocialAccess[]): boolean {
  return memberships.some((m) => {
    if (m.membershipType === "social_only") return true;
    const kind = m.groupKind ?? "team";
    return kind !== "one_on_one";
  });
}
