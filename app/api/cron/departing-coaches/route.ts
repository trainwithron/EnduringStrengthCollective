import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { appOrigin } from "@/lib/app-url";
import { readByIds } from "@/lib/read-by-ids";
import { runPool } from "@/lib/run-pool";
import { departurePlan, daysLeftToChoose, windowEndsAt, type DepartureRow } from "@/lib/leaving-coach-policy";
import { remindCoach, sendCoachTheirExport, tellClientCoachClosed, tellCoachTheyAreLeaving } from "@/lib/leaving-coach-notify";

// Every six hours: walks the coaches who are leaving (migration 0396). For each, once only: the notice that they are leaving, the reminders with three days and one day left, ending coaching access when the
// seven days are over (the database does it, and only for a coach who is leaving, not let go, and past seven days), then the export link to the coach and a notice to the clients they kept that the account closed.
// Each step is claimed (its own timestamp) before it is sent, so two overlapping runs never send twice; a step that could not be delivered is given back to the next run. A coach who was let go is already ended
// (the database did it at once) and only gets the closing step.
export const maxDuration = 120;
const AT_ONCE = 6;

type Row = {
  organization_id: string;
  profile_id: string;
  departing_since: string;
  fired_at: string | null;
  access_ended_at: string | null;
  departure_notified_at: string | null;
  reminded_3d_at: string | null;
  reminded_1d_at: string | null;
  closure_notified_at: string | null;
  departing_group_ids: string[] | null;
  organizations: { name: string | null; display_name: string | null } | null;
};

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();
  const origin = appOrigin(request);
  const { data, error } = await db
    .from("organization_memberships")
    .select(
      "organization_id, profile_id, departing_since, fired_at, access_ended_at, departure_notified_at, reminded_3d_at, reminded_1d_at, closure_notified_at, departing_group_ids, organizations ( name, display_name )"
    )
    .not("departing_since", "is", null)
    .is("closure_notified_at", null)
    .order("departing_since", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: "Could not read the coaches who are leaving." }, { status: 500 });

  const claim = async (row: Row, column: string): Promise<boolean> => {
    const { data: claimed } = await db
      .from("organization_memberships")
      .update({ [column]: new Date().toISOString() })
      .eq("organization_id", row.organization_id)
      .eq("profile_id", row.profile_id)
      .is(column, null)
      .select("profile_id");
    return (claimed ?? []).length > 0;
  };
  const giveBack = async (row: Row, column: string) => {
    await db.from("organization_memberships").update({ [column]: null }).eq("organization_id", row.organization_id).eq("profile_id", row.profile_id);
  };

  const stats = { told: 0, reminded: 0, ended: 0, exported: 0, clientsTold: 0 };
  await runPool(
    (data ?? []) as unknown as Row[],
    AT_ONCE,
    async (row) => {
      const now = new Date();
      const orgName = row.organizations?.display_name || row.organizations?.name || "your organization";
      const state: DepartureRow = {
        departingSince: row.departing_since,
        firedAt: row.fired_at,
        accessEndedAt: row.access_ended_at,
        departureNotifiedAt: row.departure_notified_at,
        reminded3dAt: row.reminded_3d_at,
        reminded1dAt: row.reminded_1d_at,
        closureNotifiedAt: row.closure_notified_at,
      };
      const plan = departurePlan(state, now);
      const endsAt = windowEndsAt(row.departing_since);

      if (plan.tellThemTheyAreLeaving && (await claim(row, "departure_notified_at"))) {
        if (await tellCoachTheyAreLeaving(db, { coachId: row.profile_id, orgName, endsAt, origin })) stats.told++;
        else await giveBack(row, "departure_notified_at");
      }
      for (const [step, column] of [
        [plan.remind3, "reminded_3d_at"],
        [plan.remind1, "reminded_1d_at"],
      ] as const) {
        if (step && (await claim(row, column))) {
          if (await remindCoach(db, { coachId: row.profile_id, orgName, daysLeft: Math.max(1, daysLeftToChoose(row.departing_since, now)), endsAt, origin })) stats.reminded++;
          else await giveBack(row, column);
        }
      }

      let ended = !!row.access_ended_at;
      if (plan.endAccess) {
        const { data: did, error: endError } = await db.rpc("end_departure_access", { p_org: row.organization_id, p_coach: row.profile_id });
        if (endError) console.error("departing-coaches: could not end access:", endError.message);
        else if (did === true) {
          ended = true;
          stats.ended++;
        }
      }

      if (ended && !row.closure_notified_at && (await claim(row, "closure_notified_at"))) {
        const delivered = await sendCoachTheirExport(db, { coachId: row.profile_id, orgName, fired: !!row.fired_at, origin });
        if (!delivered) {
          await giveBack(row, "closure_notified_at");
          return;
        }
        stats.exported++;
        // The clients they kept hear that the account closed, and where to take their own data.
        const groupIds = row.departing_group_ids ?? [];
        const athletes = await readByIds(groupIds, (ids) => (from, to) => db.from("group_memberships").select("id, profile_id").in("group_id", ids).eq("role", "athlete").order("id").range(from, to), { maxPages: 50 });
        const clientIds = [...new Set(athletes.rows.map((a: { profile_id: string }) => a.profile_id))];
        await runPool(clientIds, AT_ONCE, async (clientId) => {
          if (await tellClientCoachClosed(db, { clientId, origin })) stats.clientsTold++;
        }, { deadlineMs: 60_000 });
      }
    },
    { deadlineMs: 100_000 }
  );

  return NextResponse.json({ looked: (data ?? []).length, ...stats });
}

export const GET = withCronRun("departing-coaches", handler);
