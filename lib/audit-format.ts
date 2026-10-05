// How an audit_log row reads on the admin page: "is_platform_admin: false -> true". Pure, so the wording is tested.
export interface AuditChange {
  old?: unknown;
  new?: unknown;
}

const show = (v: unknown): string => (v === undefined ? "?" : v === null ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function describeChanges(changed: Record<string, AuditChange> | null | undefined): string {
  const entries = Object.entries(changed ?? {});
  if (entries.length === 0) return "";
  return entries
    .map(([col, c]) => ("old" in c ? `${col}: ${show(c.old)} \u2192 ${show(c.new)}` : `${col}: ${show(c.new)}`))
    .join("; ");
}

export function describeAction(action: string, actorRole: string): string {
  if (action === "blocked_write") return "Blocked attempt";
  const by = actorRole === "service_role" ? "by the server" : actorRole === "sql_editor" ? "from the SQL editor" : "by a signed-in user";
  return `${action === "insert" ? "Created" : "Changed"} ${by}`;
}
