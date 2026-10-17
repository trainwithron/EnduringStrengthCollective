import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { appOrigin } from "@/lib/app-url";
import { readByIds } from "@/lib/read-by-ids";
import { runPool } from "@/lib/run-pool";
import { athleteAgeStatus } from "@/lib/youth-block";
import { departurePlan, daysLeftToChoose, windowEndsAt, exportLinkStillWorks, EXPORT_LINK_DAYS, type DepartureRow } from "@/lib/leaving-coach-policy";
import { remindCoach, sendCoachTheirExport, tellClientCoachClosed, tellCoachTheyAreLeaving } from "@/lib/leaving-coach-notify";
import { storeExitExport, sweepOrphanExports, EXIT_EXPORT_BUCKET } from "@/lib/leaving-coach-export";
import { groupsStillTheirs } from "@/lib/leaving-coach-groups";

// Every six hours: walks the coaches who are leaving (migration 0396). For each, once only: the notice that they are leaving, the reminders with three days and one day left, ending coaching access when the
// seven days are over (the database does it, and only for a coach who is leaving, not let go, and past seven days); then, for a coach whose access has ended: make and store their ONE export (so it never
// changes afterwards), tell them it is ready, and tell the clients they kept that the account closed. A step is marked done only after it was delivered, and a client notice is never sent twice, so a run that
// dies halfway is finished by the next one. A coach who was let go is already ended (the database did it at once) and only gets the closing steps.
export const maxDuration = 300;
const AT_ONCE = 6;
const MAX_EXPORT_ATTEMPTS = 3;

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
  export_attempts: number;
  export_failed_at: string | null;
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
      "organization_id, profile_id, departing_since, fired_at, access_ended_at, departure_notified_at, reminded_3d_at, reminded_1d_at, closure_notified_at, clients_notified_at, export_path, export_attempts, export_failed_at, departing_group_ids, organizations ( name, display_name )"
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

  // The stored file is removed when its 30 days end (the clients' records themselves stay where they are, under RETENTION_DAYS). Idempotent: a file already gone is simply forgotten.
  const expiredBefore = new Date(Date.now() - EXPORT_LINK_DAYS * 86_400_000).toISOString();
  const { data: stale } = await db.from("organization_memberships").select("organization_id, profile_id, export_path").not("export_path", "is", null).lt("access_ended_at", expiredBefore).limit(100);
  let expired = 0;
  for (const s of (stale ?? []) as { organization_id: string; profile_id: string; export_path: string }[]) {
    const { error: removeError } = await db.storage.from(EXIT_EXPORT_BUCKET).remove([s.export_path]);
    if (removeError) {
      console.error("departing-coaches: could not remove an expired export:", removeError.message);
      continue;
    }
    await db.from("organization_memberships").update({ export_path: null }).eq("organization_id", s.organization_id).eq("profile_id", s.profile_id);
    expired++;
  }

  const orphansRemoved = await sweepOrphanExports(db);

  const stats = { told: 0, reminded: 0, ended: 0, exports: 0, exportsFailed: 0, coachesTold: 0, clientsTold: 0 };
  // One stored export is built per run: each is held in memory, so the rest wait for the next run.
  let exportBudget = 1;
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
      // Past the 30 days nothing more is sent or made: the row is retired.
      if (!exportLinkStillWorks(endedAt, now)) {
        await mark(row, "closure_notified_at");
        await mark(row, "clients_notified_at");
        return;
      }
      // Only the kept groups that are still the situation the notices assume: still in that organization, and with no coach now.
      const still = await groupsStillTheirs(db, row.organization_id, row.departing_group_ids ?? []);
      if (still.failed) return;
      const groupIds = still.ids;

      // 1. The coach's one export, made now and kept as it is. ONE export is built per run (they are big and held in memory), a few tries are made, and then it is given up on: the notices below never wait on it.
      let exportPath = row.export_path;
      let exportFailed = !!row.export_failed_at;
      if (!exportPath && !exportFailed && groupIds.length > 0 && exportLinkStillWorks(endedAt, now) && exportBudget > 0) {
        exportBudget--;
        exportPath = await storeExitExport(db, { coachId: row.profile_id, organizationId: row.organization_id, groupIds, orgName });
        if (exportPath) {
          await db.from("organization_memberships").update({ export_path: exportPath, export_created_at: new Date().toISOString() }).eq("organization_id", row.organization_id).eq("profile_id", row.profile_id);
          stats.exports++;
        } else {
          const attempts = row.export_attempts + 1;
          exportFailed = attempts >= MAX_EXPORT_ATTEMPTS;
          await db.from("organization_memberships").update({ export_attempts: attempts, ...(exportFailed ? { export_failed_at: new Date().toISOString() } : {}) }).eq("organization_id", row.organization_id).eq("profile_id", row.profile_id);
          stats.exportsFailed++;
        }
      }

      // 2. Tell the coach (marked only after it was delivered): the export is ready, or it could not be stored ahead and is made when the link is opened. Nothing is sent while a try is still to come.
      if (!row.closure_notified_at && (exportPath || exportFailed || groupIds.length === 0)) {
        if (await sendCoachTheirExport(db, { coachId: row.profile_id, orgName, fired: !!row.fired_at, origin, couldNotStore: !exportPath })) {
          await mark(row, "closure_notified_at");
          stats.coachesTold++;
        }
      }

      // 3. Tell the clients they kept (their training clients only), each once, whatever happened with the export. The step is marked done only when every one has been told.
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
        }, { deadlineMs: 60_000 });
        if (run.failed.length === 0 && run.notStarted.length === 0) await mark(row, "clients_notified_at");
      }
    },
    { deadlineMs: 270_000 }
  );

  return NextResponse.json({ looked: (data ?? []).length, expiredExports: expired, orphansRemoved, ...stats });
}

export const GET = withCronRun("departing-coaches", handler);
