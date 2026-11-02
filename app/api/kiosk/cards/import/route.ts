import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { runPool } from "@/lib/run-pool";
import { emailsForExport } from "@/lib/leaving-coach-export";
import { matchCardRows, normalizeCardCode, type CardRow } from "@/lib/checkin-cards";

// Key cards from a member export (Ron, Nov 2: "a CSV export from MindBody for all of them and then a CSV upload into this"). The rows come parsed from the browser; they are
// matched to the clients this coach may manage (kiosk_settings_roster, run as the coach) by email, then by full name, and each match is linked with set_checkin_card, also run
// as the coach, so the database decides every one. The server key only looks up the clients' sign-in emails to match by.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("kiosk-cards-import", user.id, 10, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { organizationId?: unknown; rows?: unknown };
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const rawRows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (!organizationId || rawRows.length === 0) return NextResponse.json({ error: "Nothing to bring in." }, { status: 400 });
  const rows: CardRow[] = rawRows
    .map((r) => r as Partial<CardRow>)
    .map((r) => ({ name: String(r.name ?? "").slice(0, 200), email: String(r.email ?? "").slice(0, 320).toLowerCase(), code: normalizeCardCode(r.code) ?? "" }))
    .filter((r) => r.code && (r.name || r.email));

  const { data: roster, error: rosterError } = await supabase.rpc("kiosk_settings_roster", { p_org: organizationId });
  if (rosterError) return NextResponse.json({ error: "Only the organization's coaches can bring cards in." }, { status: 403 });
  const people = new Map<string, { athleteId: string; fullName: string; email?: string | null }>();
  for (const r of (roster ?? []) as { athlete_id: string; full_name: string }[]) people.set(r.athlete_id, { athleteId: r.athlete_id, fullName: r.full_name });
  // Emails help the match; if they cannot be read, names still match.
  try {
    const emails = await emailsForExport(createServiceRoleClient())([...people.keys()]);
    for (const [id, email] of emails) {
      const p = people.get(id);
      if (p) p.email = email;
    }
  } catch {
    // names only
  }

  const { matched, unmatched } = matchCardRows(rows, [...people.values()]);
  let linked = 0;
  const taken: string[] = [];
  const failed: string[] = [];
  await runPool(matched, 6, async (m) => {
    const { data, error } = await supabase.rpc("set_checkin_card", { p_org: organizationId, p_athlete: m.athleteId, p_code: m.code });
    if (error) failed.push(m.name);
    else if (data === "taken") taken.push(m.name);
    else linked++;
  });
  return NextResponse.json({ linked, taken, unmatched: [...unmatched, ...failed] });
}
