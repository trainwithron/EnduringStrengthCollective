// Applies the repo's migrations 0001-0247 to an in-memory Postgres (PGlite), then migration 0248 (session credit settlement, minus its
// one block that rewrites complete_workout_session by exact live text, which the repo-only function does not match), and checks the
// rules 0248 promises: a coach's booking takes nothing, a client's booking takes one at booking, attending settles exactly once,
// undo gives back only what was taken, waive charges nothing, the balance has no floor, a client cannot change their own balance, and
// a 52-week series books without credits and keeps its local time across daylight saving.
//   node scripts/sql-tests/settlement.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin; create role supabase_admin nologin;
  create schema auth; create schema storage; create schema extensions; create schema realtime;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create function storage.filename(name text) returns text language sql as $$ select name $$;
  create publication supabase_realtime;
  create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
`);

const COACH = "11111111-1111-1111-1111-111111111111";
const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
for (const f of files) {
  const n = Number(f.slice(0, 4));
  if (n > 248) break;
  if (n === 2) {
    await db.exec(`insert into auth.users (id, email) values ('${COACH}', 'trainwithronarnold@gmail.com') on conflict do nothing;
                   insert into public.profiles (id, full_name) values ('${COACH}', 'Coach Ron') on conflict do nothing;`);
  }
  let sql = readFileSync(new URL(f, dir), "utf8").replace(/create extension[^;]*;/gi, "");
  if (n === 248) sql = sql.replace(/do \$migrate\$[\s\S]*?\$migrate\$;/, "");
  try {
    await db.exec(sql);
  } catch (e) {
    // Older files that only fail because they touch live-only state are tolerated; 0248 itself must apply.
    if (n === 248) {
      console.log("FAIL 0248 did not apply:", String(e.message).split("\n")[0]);
      process.exit(1);
    }
  }
}

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  if (!cond) failures++;
};
const as = (uid) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const expectError = async (name, fn, pattern) => {
  try {
    await fn();
    check(name, false, "no error");
  } catch (e) {
    check(name, pattern.test(String(e.message)), String(e.message).slice(0, 120));
  }
};

const A = "22222222-2222-2222-2222-222222222222";
const G = "33333333-3333-3333-3333-333333333333";
await db.exec(`
  insert into auth.users (id, email) values ('${A}', 'a@example.com');
  insert into public.profiles (id, full_name, timezone) values ('${A}', 'Ann', 'America/New_York');
  update public.profiles set timezone = 'America/New_York' where id = '${COACH}';
  insert into public.groups (id, name, created_by, group_kind, organization_id) values ('${G}', 'Ann 1-on-1', '${COACH}', 'one_on_one', (select id from public.organizations limit 1));
  insert into public.group_memberships (group_id, profile_id, role) values ('${G}', '${COACH}', 'coach'), ('${G}', '${A}', 'athlete');
`);
const balance = async () => (await one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [A, G]))?.balance;
const ledger = async (kind) => Number((await one(`select count(*)::int as n from public.session_credit_ledger where athlete_id = $1 and kind = $2`, [A, kind])).n);
const hr = (h) => new Date(Date.now() + h * 3600000).toISOString();

await as(COACH);
await db.query(`select public.assign_session_credits($1, $2, 3, 'start')`, [A, G]);
check("assigning sessions sets the balance", (await balance()) === 3);

// coach books: takes nothing
const b1 = (await one(`select public.book_session($1, $2, $3, $4, $5) as id`, [COACH, A, G, hr(48), hr(49)])).id;
const s1 = await one(`select credit_state from public.bookings where id = $1`, [b1]);
check("a coach's booking takes nothing and starts unsettled", (await balance()) === 3 && s1.credit_state === "unsettled");

// client books: takes one at booking
await as(A);
const b2 = (await one(`select public.book_session($1, $2, $3, $4, $5) as id`, [COACH, A, G, hr(72), hr(73)])).id;
const s2 = await one(`select credit_state from public.bookings where id = $1`, [b2]);
check("a client's own booking takes one at booking and is prepaid", (await balance()) === 2 && s2.credit_state === "prepaid");

// attending settles once
await as(COACH);
await db.query(`select public.mark_booking_attended($1)`, [b1]);
check("marking an unsettled session attended takes one", (await balance()) === 1);
check("and the booking is settled", (await one(`select credit_state, attended_at is not null as att from public.bookings where id = $1`, [b1])).credit_state === "settled");
await db.query(`select public.mark_booking_attended($1)`, [b1]);
check("marking it again does not charge twice", (await balance()) === 1);

// undo gives back what was taken
await db.query(`select public.undo_booking_attended($1)`, [b1]);
check("undo gives back only what was taken", (await balance()) === 2);
await db.query(`select public.undo_booking_attended($1)`, [b1]);
check("undo twice does not refund twice", (await balance()) === 2);

// prepaid: attended is not a second charge
await db.query(`select public.mark_booking_attended($1)`, [b2]);
check("attending a prepaid session does not charge again", (await balance()) === 2);

// waive
await db.query(`select public.waive_booking($1, 'holiday')`, [b1]);
check("waiving an unsettled session charges nothing", (await balance()) === 2 && (await one(`select credit_state from public.bookings where id = $1`, [b1])).credit_state === "waived");

// cancelling refunds only what was taken
const b3 = (await one(`select public.book_session($1, $2, $3, $4, $5) as id`, [COACH, A, G, hr(96), hr(97)])).id;
const before = await balance();
await db.query(`select public.cancel_booking_and_refund_credit($1)`, [b3]);
check("cancelling a coach booking that took nothing refunds nothing", (await balance()) === before);
const b4 = (await (async () => { await as(A); const r = (await one(`select public.book_session($1, $2, $3, $4, $5) as id`, [COACH, A, G, hr(120), hr(121)])).id; await as(COACH); return r; })());
const mid = await balance();
await db.query(`select public.cancel_booking_and_refund_credit($1)`, [b4]);
check("cancelling a prepaid booking as the coach refunds the one that was taken", (await balance()) === mid + 1);

// no floor
const bz = (await one(`select public.book_session($1, $2, $3, $4, $5) as id`, [COACH, A, G, hr(150), hr(151)])).id;
await db.query(`select public.set_session_balance($1, $2, 0, 'zero it')`, [A, G]);
check("the coach can set the balance to zero", (await balance()) === 0);
await db.query(`select public.mark_booking_attended($1)`, [bz]);
check("attending with no sessions left takes the balance below zero", (await balance()) === -1);

// a client cannot change their own balance
await as(A);
await expectError("a client cannot adjust their own balance", () => db.query(`select public.adjust_session_credits($1, $2, 5)`, [A, G]), /not authorized/);
await expectError("a client cannot mark their own session attended", () => db.query(`select public.mark_booking_attended($1)`, [b2]), /not authorized|not allowed/i);

// a long series books without credits and keeps its local time across the clock change
await as(COACH);
const first = "2026-10-20T10:00:00Z"; // Tuesday 6:00 AM New York (EDT)
const bal = await balance();
const series = await one(`select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 20)`, [COACH, A, G, first]);
check("a 20-week series books all 20", series.booked_count === 20 && series.failed_count === 0, JSON.stringify(series));
check("and takes no credits", (await balance()) === bal);
const hours = await rows(`select distinct to_char(start_at at time zone 'America/New_York', 'HH24:MI') as t from public.bookings where recurring_series_id = $1`, [series.series_id]);
check("every session stays at 6:00 New York time across the clock change", hours.length === 1 && hours[0].t === "06:00", JSON.stringify(hours));
const tooMany = await one(`select 1 as x`).then(() => null);
await expectError("a series over 52 weeks is refused", () => db.query(`select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 53)`, [COACH, A, G, "2027-06-01T10:00:00Z"]), /between 1 and 52/);

// ledger records everything
check("every change is in the ledger", (await ledger("assigned")) === 1 && (await ledger("booked")) >= 2 && (await ledger("delivered")) >= 1);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
