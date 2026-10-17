import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { appOrigin } from "@/lib/app-url";
import { readByIds } from "@/lib/read-by-ids";
import { runPool } from "@/lib/run-pool";
import { athleteAgeStatus } from "@/lib/youth-block";
import { departurePlan, daysLeftToChoose, windowEndsAt, type DepartureRow } from "@/lib/leaving-coach-policy";
import { remindCoach, sendCoachTheirExport, tellClientCoachClosed, tellCoachTheyAreLeaving } from "@/lib/leaving-coach-notify";
import { storeExitExport } from "@/lib/leaving-coach-export";

// Every six hours: walks the coaches who are leaving (migration 0396). For each, once only: the notice that they are leaving, the reminders with three days and one day left, ending coaching access when the
// seven days are over (the database does it, and only for a coach who is leaving, not let go, and past seven days); then, for a coach whose access has ended: make and store their ONE export (so it never
// changes afterwards), tell them it is ready, and tell the clients they kept that the account closed. A step is marked done only after it was delivered, and a client notice is never sent twice, so a run that
// dies halfway is finished by the next one. A coach who was let go is already ended (the database did it at once) and only gets the closing steps.
export const maxDuration = 300;
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
  clients_notified_at: string | null;
  export_path: string | null;
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
      "organization_id, profile_id, departing_since, fired_at, access_ended_at, departure_notified_at, reminded_3d_at, reminded_1d_at, closure_notified_at, clients_notified_at, export_path, departing_group_ids, organizations ( name, display_name )"
    )
    .not("departing_since", "is", null)
    .or("closure_notified_at.is.null,clients_notified_at.is.null")
    .order("departing_since", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: "Could not read the coaches who are leaving." }, { status: 500 });

  const mark = async (row: Row, column: string) => {
    await db.from("organization_memberships").update({ [column]: new Date().toISOString() }).eq("organization_id", row.organization_id).eq("profile_id", row.profile_id).is(column, null);
  };
  // For the early notices a claim comes first (a duplicate reminder is worse than a missed one); it is given back when nothing could be delivered.
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

  const stats = { told: 0, reminded: 0, ended: 0, exports: 0, coachesTold: 0, clientsTold: 0 };
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
        clientsNotifiedAt: row.clients_notified_at,
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
      let endedAt = row.access_ended_at;
      if (plan.endAccess) {
        const { data: did, error: endError } = await db.rpc("end_departure_access", { p_org: row.organization_id, p_coach: row.profile_id });
        if (endError) console.error("departing-coaches: could not end access:", endError.message);
        else if (did === true) {
          ended = true;
          endedAt = now.toISOString();
          stats.ended++;
        }
      }
      if (!ended || !plan.closure) return;
      const groupIds = row.departing_group_ids ?? [];

      // 1. The coach's one export, made now and kept as it is. Nothing else happens until it exists (the next run tries again if it could not be made).
      let exportPath = row.export_path;
      if (!exportPath && groupIds.length > 0) {
        exportPath = await storeExitExport(db, { coachId: row.profile_id, organizationId: row.organization_id, groupIds, orgName });
        if (!exportPath) return;
        await db.from("organization_memberships").update({ export_path: exportPath, export_created_at: new Date().toISOString() }).eq("organization_id", row.organization_id).eq("profile_id", row.profile_id);
        stats.exports++;
      }

      // 2. Tell the coach it is ready (marked only after it was delivered).
      if (!row.closure_notified_at) {
        if (await sendCoachTheirExport(db, { coachId: row.profile_id, orgName, fired: !!row.fired_at, origin })) {
          await mark(row, "closure_notified_at");
          stats.coachesTold++;
        }
      }

      // 3. Tell the clients they kept (their training clients only), each once. The step is marked done only when every one has been told.
      if (!row.clients_notified_at) {
        const athletes = await readByIds(groupIds, (ids) => (from, to) => db.from("group_memberships").select("id, profile_id").in("group_id", ids).eq("role", "athlete").eq("membership_type", "training").order("id").range(from, to), { maxPages: 200 });
        if (athletes.failed) return;
        const clientIds = [...new Set(athletes.rows.map((a: { profile_id: string }) => a.profile_id))];
        const since = endedAt ?? now.toISOString();
        const alreadyTold = new Set<string>();
        for (let i = 0; i < clientIds.length; i += 200) {
          const { data: told } = await db.from("notifications").select("profile_id").eq("type", "coach_account_closed").in("profile_id", clientIds.slice(i, i + 200)).gte("created_at", since);
          for (const t of (told ?? []) as { profile_id: string }[]) alreadyTold.add(t.profile_id);
        }
        const todo = clientIds.filter((id) => !alreadyTold.has(id));
        const run = await runPool(todo, AT_ONCE, async (clientId) => {
          const adult = (await athleteAgeStatus(db, clientId)) === "adult";
          if (await tellClientCoachClosed(db, { clientId, origin, emailToo: adult })) stats.clientsTold++;
          else throw new Error("not delivered");
        }, { deadlineMs: 120_000 });
        if (run.failed.length === 0 && run.notStarted.length === 0) await mark(row, "clients_notified_at");
      }
    },
    { deadlineMs: 270_000 }
  );

  return NextResponse.json({ looked: (data ?? []).length, ...stats });
}

export const GET = withCronRun("departing-coaches", handler);
