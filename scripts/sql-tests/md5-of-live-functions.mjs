// Prints the md5 of each function's definition (what pg_get_functiondef returns) on the live-equivalent schema built from the repo's migrations
// through 0276. The paste files for steps that REPLACE a function put this md5 in their precheck and guard: if the live definition differs, the
// step refuses to run, so it can never overwrite work that was done outside the repo.
//   node scripts/sql-tests/md5-of-live-functions.mjs
import { createDb, applyLiveEquivalent, applyOne, PLAN_ORDER } from "./harness.mjs";

const db = await createDb();
await applyLiveEquivalent(db);
for (const n of PLAN_ORDER) {
  await applyOne(db, n);
  if (n === "0276") break;
}
for (const sig of [
  "public.cancel_booking_and_refund_credit(uuid)",
  "public.reschedule_booking(uuid, timestamptz, timestamptz)",
  "public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)",
]) {
  const { rows } = await db.query(`select md5(pg_get_functiondef('${sig}'::regprocedure)) as m`);
  console.log(`${sig} ${rows[0].m}`);
}
process.exit(0);
