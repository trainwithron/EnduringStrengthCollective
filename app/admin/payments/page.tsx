import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

// Four read-only checks for the platform admin (Release M1): money that is out of step with who is in the app. Nothing here changes anything. Each row is a count and one example (a Stripe id to look up in the dashboard).
export default async function AdminPaymentsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_platform_admin) {
    return <NoAccess>You don&apos;t have access to this page.</NoAccess>;
  }

  const { data, error } = await supabase.rpc("payment_reconciliation_report");
  const rows = (data ?? []) as { check_name: string; what: string; issue_count: number; example: string | null }[];

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-4xl mx-auto">
        <Link href="/admin/organizations" className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Admin
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Payment checks</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Four read-only checks for money that is out of step with who is in the app. A count of 0 is what you want. Look the example up in the Stripe dashboard.
        </p>
        {error ? (
          <p className="font-body text-sm text-steel mt-6">The payment checks aren&apos;t switched on yet (migration 0409 hasn&apos;t been applied).</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left font-body text-sm">
              <caption className="sr-only">Payment checks</caption>
              <thead>
                <tr className="text-xs text-steel uppercase tracking-wide">
                  <th scope="col" className="py-2 pr-4 font-normal">Check</th>
                  <th scope="col" className="py-2 pr-4 font-normal text-right">Found</th>
                  <th scope="col" className="py-2 font-normal">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel/15">
                {rows.map((r) => (
                  <tr key={r.check_name} className="align-top">
                    <td className="py-2 pr-4 text-chalk">{r.what}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${Number(r.issue_count) > 0 ? "text-rust" : "text-steel"}`}>{Number(r.issue_count)}</td>
                    <td className="py-2 text-steel break-all">{r.example ?? "–"}</td>
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
