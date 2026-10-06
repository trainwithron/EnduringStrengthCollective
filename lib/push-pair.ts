// Who may push to whom. The push route reads the recipient's subscriptions with the server's own access (a client's own session cannot
// read their coach's), so the check has to be made here. A push is allowed to:
//   * yourself,
//   * someone in a group where one of the two of you is the coach (a coach and their client; never two teammates who are both just members),
//   * someone in your organization when one of you is its owner or admin (a coach telling the owner, say),
//   * an accepted training partner (the one cross-organization link between clients).
// Anyone else is refused, so the route cannot be used to ping a stranger or to message a teammate.
type Row = Record<string, string>;

async function rows(db: any, table: string, cols: string, filters: Record<string, string>): Promise<Row[]> {
  let q = db.from(table).select(cols);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data } = await q;
  return (data ?? []) as Row[];
}

export async function mayPushTo(db: any, senderId: string, targetId: string): Promise<boolean> {
  if (senderId === targetId) return true;

  const [mine, theirs] = await Promise.all([
    rows(db, "group_memberships", "group_id, role", { profile_id: senderId }),
    rows(db, "group_memberships", "group_id, role", { profile_id: targetId }),
  ]);
  const theirRole = new Map(theirs.map((r) => [r.group_id, r.role]));
  for (const m of mine) {
    const t = theirRole.get(m.group_id);
    if (t && (m.role === "coach" || t === "coach")) return true;
  }

  const [myOrgs, theirOrgs] = await Promise.all([
    rows(db, "organization_memberships", "organization_id, role", { profile_id: senderId }),
    rows(db, "organization_memberships", "organization_id, role", { profile_id: targetId }),
  ]);
  const theirOrgRole = new Map(theirOrgs.map((r) => [r.organization_id, r.role]));
  for (const o of myOrgs) {
    const t = theirOrgRole.get(o.organization_id);
    if (t && (["owner", "admin"].includes(o.role) || ["owner", "admin"].includes(t))) return true;
  }

  const [a, b] = await Promise.all([
    rows(db, "training_partner_requests", "id", { from_athlete_id: senderId, to_athlete_id: targetId, status: "accepted" }),
    rows(db, "training_partner_requests", "id", { from_athlete_id: targetId, to_athlete_id: senderId, status: "accepted" }),
  ]);
  return a.length + b.length > 0;
}

export function clampPush(title: unknown, body: unknown): { title: string; body: string } {
  const t = typeof title === "string" ? title.trim().slice(0, 80) : "";
  const b = typeof body === "string" ? body.trim().slice(0, 140) : "";
  return { title: t, body: b };
}
