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
  "public.create_recurring_booking_series(uuid, uuid, uuid, timestamptz, int, int)",
  "public.join_booking_waitlist(uuid, uuid, uuid, timestamptz, timestamptz)",
]) {
  const { rows } = await db.query(`select md5(replace(pg_get_functiondef('${sig}'::regprocedure), chr(13), '')) as m`);
  console.log(`${sig} ${rows[0].m}`);
}
await applyOne(db, "0277");
const after = await db.query("select md5(replace(pg_get_functiondef('public.reschedule_booking(uuid, timestamptz, timestamptz)'::regprocedure), chr(13), '')) as m");
console.log("public.reschedule_booking(...) AFTER 0277 " + after.rows[0].m);
process.exit(0);
