// Who may push to whom. The push route reads the recipient's subscriptions with the server's own access (a client's own session cannot
// read their coach's), so the check has to be made here: the sender must be that person themselves, share a group with them, or share
// an organization with them (a coach telling the owner, say). Anyone else is refused, so the route cannot be used to ping a stranger.
export async function mayPushTo(db: any, senderId: string, targetId: string): Promise<boolean> {
  if (senderId === targetId) return true;

  const [{ data: mine }, { data: theirs }] = await Promise.all([
    db.from("group_memberships").select("group_id").eq("profile_id", senderId),
    db.from("group_memberships").select("group_id").eq("profile_id", targetId),
  ]);
  const myGroups = new Set((mine ?? []).map((r: { group_id: string }) => r.group_id));
  if ((theirs ?? []).some((r: { group_id: string }) => myGroups.has(r.group_id))) return true;

  const [{ data: myOrgs }, { data: theirOrgs }] = await Promise.all([
    db.from("organization_memberships").select("organization_id").eq("profile_id", senderId),
    db.from("organization_memberships").select("organization_id").eq("profile_id", targetId),
  ]);
  const orgSet = new Set((myOrgs ?? []).map((r: { organization_id: string }) => r.organization_id));
  return (theirOrgs ?? []).some((r: { organization_id: string }) => orgSet.has(r.organization_id));
}

export function clampPush(title: unknown, body: unknown): { title: string; body: string } {
  const t = typeof title === "string" ? title.trim().slice(0, 80) : "";
  const b = typeof body === "string" ? body.trim().slice(0, 140) : "";
  return { title: t, body: b };
}
