import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { describeAction, describeChanges } from "@/lib/audit-format";
import { formatInTimezone } from "@/lib/format-in-timezone";

const TABLES = ["profiles", "session_credits", "bookings", "organization_billing", "athlete_sessions", "workout_logs", "posts", "direct_messages", "training_partner_requests"];

// The platform admin's view of the audit trail: privileged changes and blocked attempts, newest first. Read-only; the log itself cannot be
// edited by anyone (migration 0267).
export default async function AdminAuditPage(props: { searchParams: Promise<{ table?: string; blocked?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("is_platform_admin, timezone").eq("id", user.id).maybeSingle();
  if (!profile?.is_platform_admin) {
    return (
      <NoAccess>You don&apos;t have access to this page.</NoAccess>
    );
  }

  const table = TABLES.includes(searchParams.table ?? "") ? searchParams.table! : null;
  const onlyBlocked = searchParams.blocked === "1";
  let query = supabase.from("audit_log").select("id, at, table_name, row_key, action, actor_uid, actor_role, changed").order("id", { ascending: false }).limit(200);
  if (table) query = query.eq("table_name", table);
  if (onlyBlocked) query = query.eq("action", "blocked_write");
  const { data: rows, error } = await query;

  const actorIds = [...new Set((rows ?? []).map((r: any) => r.actor_uid).filter(Boolean))] as string[];
  const { data: names } = actorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] };
  const nameById = new Map((names ?? []).map((p: any) => [p.id as string, p.full_name as string]));
  const tz = profile.timezone ?? "America/New_York";
  const href = (t: string | null, b: boolean) => `/admin/audit?${[t ? `table=${t}` : "", b ? "blocked=1" : ""].filter(Boolean).join("&")}`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-5xl mx-auto">
        <Link href="/admin/organizations" className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Admin
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Audit trail</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Changes to admin flags, waiver gates, session balances, booking credit state and billing, and attempts that were blocked. Nothing here can be edited.
        </p>

        <div className="flex flex-wrap gap-2 mt-5" role="group" aria-label="Filter">
          <Link href={href(null, onlyBlocked)} className={`font-body text-sm px-3 py-1.5 border ${!table ? "border-chalk text-chalk" : "border-steel/30 text-steel"}`}>
            All tables
          </Link>
          {TABLES.map((t) => (
            <Link key={t} href={href(t, onlyBlocked)} className={`font-body text-sm px-3 py-1.5 border ${table === t ? "border-chalk text-chalk" : "border-steel/30 text-steel"}`}>
              {t}
            </Link>
          ))}
          <Link href={href(table, !onlyBlocked)} className={`font-body text-sm px-3 py-1.5 border ${onlyBlocked ? "border-chalk text-chalk" : "border-steel/30 text-steel"}`}>
            Blocked attempts only
          </Link>
        </div>

        {error ? (
          <p className="font-body text-sm text-steel mt-6">The audit trail isn&apos;t switched on yet (migration 0267 hasn&apos;t been applied).</p>
        ) : (rows ?? []).length === 0 ? (
          <p className="font-body text-sm text-steel mt-6">Nothing recorded yet.</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left font-body text-sm">
              <thead>
                <tr className="text-xs text-steel uppercase tracking-wide">
                  <th className="py-2 pr-4 font-normal">When</th>
                  <th className="py-2 pr-4 font-normal">What</th>
                  <th className="py-2 pr-4 font-normal">Who</th>
                  <th className="py-2 font-normal">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel/15">
                {(rows ?? []).map((r: any) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-2 pr-4 text-steel whitespace-nowrap">{formatInTimezone(r.at, tz, "dateTime")}</td>
                    <td className="py-2 pr-4">
                      <span className="text-chalk">{r.table_name}</span>
                      <span className="block text-xs text-steel">{describeAction(r.action, r.actor_role)}</span>
                    </td>
                    <td className="py-2 pr-4 text-steel">{r.actor_uid ? nameById.get(r.actor_uid) ?? "Someone" : r.actor_role === "sql_editor" ? "SQL editor" : "The server"}</td>
                    <td className="py-2 text-chalk break-words">
                      {describeChanges(r.changed)}
                      {r.row_key && <span className="block text-xs text-steel">row {r.row_key}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
