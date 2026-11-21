import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { money, type PayrollSnapshot } from "@/lib/payroll-report";

const SHOWN = 50;
// Only a database without the table yet (the update is not applied) shows nothing; any other failure is said.
const TABLE_MISSING = new Set(["42P01", "PGRST205"]);

// The saved pay periods of the organization ($3, Ron Nov 20), newest first, each to reopen (and print) or download as a spreadsheet. Read only: a saved period never changes.
// Row security lets only the owner and admins read them (migration 0464).
export async function SavedPayPeriods({ orgId, timeZone }: { orgId: string; timeZone: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("payroll_reports")
    // only the totals of each (a saved period's sessions list can be long)
    .select("id, created_at, from_day, to_day, note, totals:snapshot->totals")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(SHOWN);
  if (error && TABLE_MISSING.has((error as { code?: string }).code ?? "")) return null;
  const rows = (data ?? []) as unknown as { id: string; created_at: string; from_day: string; to_day: string; note: string | null; totals: PayrollSnapshot["totals"] | null }[];

  return (
    <section aria-labelledby="saved-pay-periods" className="mt-10" data-saved-pay-periods>
      <h2 id="saved-pay-periods" className="font-display uppercase text-lg tracking-wide">
        Saved pay periods
      </h2>
      {error ? (
        <p className="font-body text-sm text-rust-ink mt-2" role="alert">
          Couldn&apos;t load the saved pay periods. Reload to try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="font-body text-sm text-steel mt-2">None yet. Save a pay period above and it is kept here, as it was.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="bg-surface rounded-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-body text-sm text-chalk">
                  {r.from_day} to {r.to_day}
                  <span className="text-steel">
                    {" "}
                    · {r.totals?.sessionsDelivered ?? 0} sessions · {money(r.totals?.estimateCents ?? 0)}
                  </span>
                </p>
                <p className="font-body text-xs text-steel">
                  Saved {formatInTimezone(r.created_at, timeZone, "date")}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/print/payroll/${r.id}`} target="_blank" rel="noopener" className="inline-flex items-center h-11 px-4 rounded-token-pill border border-rust/50 text-rust-ink font-body text-sm">
                  Open or print
                </Link>
                <a href={`/api/coach/payroll-reports/${r.id}/csv`} className="inline-flex items-center h-11 px-4 rounded-token-pill border border-steel/30 text-chalk font-body text-sm">
                  Download (spreadsheet)
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
