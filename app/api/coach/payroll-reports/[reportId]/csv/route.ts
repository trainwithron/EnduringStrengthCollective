import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { payrollCsv, type SavedPayrollReport } from "@/lib/payroll-report";

// A saved pay period as a spreadsheet ($3, Ron Nov 20). Read under the person's own sign-in: only the owner and admins of the organization can read a saved report (row
// security, migration 0464), so anyone else gets "not found". Read only.
export async function GET(_request: Request, props: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabase.from("payroll_reports").select("id, created_at, note, snapshot").eq("id", reportId).maybeSingle();
  if (error) return NextResponse.json({ error: "Couldn't read the report. Try again." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const report = data as Pick<SavedPayrollReport, "id" | "created_at" | "note" | "snapshot">;
  const p = report.snapshot.period;
  return new Response(payrollCsv(report), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pay-period-${p.fromDay}-to-${p.toDay}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
