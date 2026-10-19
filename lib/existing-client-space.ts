// Re-adding someone who is already this coach's client in ANOTHER space of the same organization (Oct 19 audit): the new one-on-one space the form made first is not wanted. The person's access is sent again for the space
// they are already in, and the empty new space is dropped, instead of inviting them to a second space.
export interface ClientSpaceCandidate {
  groupId: string;
  groupKind: string;
  organizationId: string | null;
  coachedByCaller: boolean;
}

/** The space to resend access for: one the person is a client in, in the same organization as the space being added to, that the caller coaches. A one-on-one space is preferred. Never the space being added to. */
export function pickExistingSpace(candidates: ClientSpaceCandidate[], addingToGroupId: string, organizationId: string | null): string | null {
  const usable = candidates.filter((c) => c.groupId !== addingToGroupId && c.coachedByCaller && !!organizationId && c.organizationId === organizationId);
  const solo = usable.find((c) => c.groupKind === "one_on_one");
  return (solo ?? usable[0])?.groupId ?? null;
}
