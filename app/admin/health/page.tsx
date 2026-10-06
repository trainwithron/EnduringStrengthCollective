import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { formatInTimezone } from "@/lib/format-in-timezone";

// Scheduled jobs at a glance for the platform admin: when each last ran, whether it worked, and how many runs in a row have failed. The alert
// push and email for a failing job link here. (/api/health is the same information for an uptime monitor.)
export default async function AdminHealthPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("is_platform_admin, timezone").eq("id", user.id).maybeSingle();
  if (!profile?.is_platform_admin) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You don&apos;t have access to this page.</p>
      </main>
    );
  }

  const { data: runs, error } = await supabase
    .from("cron_runs")
    .select("job, last_run_at, last_success_at, last_status, last_error, consecutive_failures")
    .order("consecutive_failures", { ascending: false })
    .order("job", { ascending: true });
  const tz = profile.timezone ?? "America/New_York";

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-4xl mx-auto">
        <Link href="/admin/organizations" className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Admin
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Scheduled jobs</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          When each job last ran and whether it worked. A job that fails repeatedly, or stops running, alerts you. See also{" "}
          <Link href="/admin/audit" className="underline">
            the audit trail
          </Link>
          .
        </p>
        {error ? (
          <p className="font-body text-sm text-steel mt-6">Job monitoring isn&apos;t switched on yet (migration 0262 hasn&apos;t been applied).</p>
        ) : (runs ?? []).length === 0 ? (
          <p className="font-body text-sm text-steel mt-6">No job has run since monitoring was switched on.</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left font-body text-sm">
              <thead>
                <tr className="text-xs text-steel uppercase tracking-wide">
                  <th className="py-2 pr-4 font-normal">Job</th>
                  <th className="py-2 pr-4 font-normal">Last run</th>
                  <th className="py-2 pr-4 font-normal">Last success</th>
                  <th className="py-2 pr-4 font-normal">Status</th>
                  <th className="py-2 font-normal">In a row failing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel/15">
                {(runs ?? []).map((r) => (
                  <tr key={r.job} className="align-top">
                    <td className="py-2 pr-4 text-chalk">{r.job}</td>
                    <td className="py-2 pr-4 text-steel whitespace-nowrap">{formatInTimezone(r.last_run_at, tz, "dateTime")}</td>
                    <td className="py-2 pr-4 text-steel whitespace-nowrap">{r.last_success_at ? formatInTimezone(r.last_success_at, tz, "dateTime") : "never"}</td>
                    <td className="py-2 pr-4">
                      <span className={r.last_status === "ok" ? "text-steel" : "text-rust"}>{r.last_status === "ok" ? "Worked" : "Failed"}</span>
                      {r.last_error && <span className="block text-xs text-steel break-words">{r.last_error}</span>}
                    </td>
                    <td className="py-2 tabular-nums">{r.consecutive_failures}</td>
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
