// Who may push to whom. The push route reads the recipient's subscriptions with the server's own access (a client's own session cannot
// read their coach's), so the check has to be made here. A browser-sent push (free text written by the sender) is allowed only to:
//   * yourself,
//   * someone in a group where one of the two of you is the coach (a coach and their client; never two teammates who are both just members).
// Anyone else is refused, so the route cannot be used to ping a stranger, a teammate, an organization owner or a training partner with text of the sender's choosing. Those events get their own notice
// written by the server (the in-app notification), not a message typed by the other person.
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

  return false;
}

export function clampPush(title: unknown, body: unknown): { title: string; body: string } {
  const t = typeof title === "string" ? title.trim().slice(0, 80) : "";
  const b = typeof body === "string" ? body.trim().slice(0, 140) : "";
  return { title: t, body: b };
}

// The rate-limit bucket for pushes from one sender to one recipient. Per sender AND recipient: a coach receives pushes from every client, so a cap on the recipient alone would starve them.
export function pushPairKey(senderId: string, recipientId: string): string {
  return `${senderId}:${recipientId}`;
}
