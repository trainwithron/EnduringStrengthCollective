// Step 215 (migration 0459) in an in-memory Postgres set up like the live tables it touches: the paste runs (and runs again) and its check row is all true; a client sends and
// changes their own weekly check-in, never someone else's, never one already reviewed, and never marks it reviewed themselves; a coach of the space reads it and can only mark
// it reviewed (with a reply that is a message they really sent this client); a coach of another space and someone signed out see nothing; the new notice type is allowed and
// belongs to the Client activity switch; scan rows are the server's alone and a coach counts only their own machines; the undo takes it all away.
// Run: node scripts/sql-tests/weekly-checkins.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8").split("\r\n").join("\n");
const paste = file("apply/apply-step215-0459.sql");
const undo = file("apply/undo-step215-0459.sql");
const COACH = "22222222-2222-2222-2222-222222222222";
const OTHER_COACH = "33333333-3333-3333-3333-333333333333";
const ANN = "44444444-4444-4444-4444-444444444444";
const BO = "55555555-5555-5555-5555-555555555555";
const STRANGER = "66666666-6666-6666-6666-666666666666";
const G1 = "99999999-0000-0000-0000-000000000001";
const G2 = "99999999-0000-0000-0000-000000000002";
const MONDAY = "2026-11-16";
const M1 = "88888888-0000-0000-0000-000000000001";
const M2 = "88888888-0000-0000-0000-000000000002";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key);
  insert into public.profiles values ('${COACH}'), ('${OTHER_COACH}'), ('${ANN}'), ('${BO}'), ('${STRANGER}');
  create table public.groups (id uuid primary key);
  insert into public.groups values ('${G1}'), ('${G2}');
  create table public.group_memberships (group_id uuid not null, profile_id uuid not null, role text not null);
  insert into public.group_memberships values ('${G1}', '${COACH}', 'coach'), ('${G1}', '${ANN}', 'athlete'), ('${G1}', '${BO}', 'athlete'), ('${G2}', '${OTHER_COACH}', 'coach');
  grant select on public.group_memberships to authenticated;
  create function public.is_group_coach(_group_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = auth.uid() and role = 'coach') $$;
  create function public.group_in_active_org(_group_id uuid) returns boolean language sql stable as $$ select true $$;
  create table public.direct_messages (id uuid primary key default gen_random_uuid(), group_id uuid not null, sender_id uuid not null, recipient_id uuid not null, body text not null);
  create table public.notifications (id uuid primary key default gen_random_uuid(), profile_id uuid, group_id uuid, type text not null, body text,
    constraint notifications_type_check check (type = any (array['comment'::text, 'direct_message'::text, 'goal_answered'::text, 'goal_proposed'::text, 'booking_request'::text, 'support_reply'::text])));
  create table public.exercise_library (id uuid primary key default gen_random_uuid(), created_by uuid);
  create table public.gym_machines (id uuid primary key, created_by uuid not null, name text not null);
  insert into public.gym_machines values ('${M1}', '${COACH}', 'Viking press'), ('${M2}', '${OTHER_COACH}', 'Leg press');
  create table public.client_goal_sheets (id uuid primary key default gen_random_uuid(), athlete_id uuid not null, group_id uuid not null, filled_at timestamptz, unique (athlete_id, group_id));
`);

const as = async (who, fn, role = "authenticated") => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${who ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
};
const fails = async (sql) => {
  try {
    await db.exec(sql);
  } catch {
    return true;
  }
  return false;
};
const changed = async (sql) => (await db.query(sql)).affectedRows ?? 0;
const send = (athlete, extra = "") => `insert into public.weekly_checkins (group_id, athlete_id, coach_id, week_start, energy, eating, win, hard${extra ? ", " + extra.split("=")[0] : ""}) values ('${G1}', '${athlete}', '${COACH}', '${MONDAY}', 4, 2, 'Hit every session', 'Late nights'${extra ? ", " + extra.split("=")[1] : ""})`;

// the paste runs, twice, and its check row is all true
const at = paste.indexOf("-- check: one row");
assert.ok(at > 0, "the paste has its check");
await db.exec(paste.slice(0, at));
await db.exec(paste.slice(0, at));
const check = (await db.query(paste.slice(at))).rows[0];
assert.ok(Object.keys(check).length >= 8, "the check row has its columns");
for (const [k, v] of Object.entries(check)) assert.equal(v, true, `check row: ${k}`);

// the client sends their own; not for someone else, not already reviewed, not on a day that is not a Monday, once a week
await as(ANN, async () => {
  assert.equal(await fails(send(BO)), true, "a check-in for another client");
  assert.equal(await fails(send(ANN, "reviewed_at=now()")), true, "a check-in sent as already reviewed");
  assert.equal(await fails(`insert into public.weekly_checkins (group_id, athlete_id, week_start, energy, eating) values ('${G1}', '${ANN}', '2026-11-17', 3, 3)`), true, "a week that does not start on Monday");
  assert.equal(await fails(`insert into public.weekly_checkins (group_id, athlete_id, week_start, energy, eating) values ('${G1}', '${ANN}', '${MONDAY}', 6, 3)`), true, "an answer past 5");
  assert.equal(await fails(send(ANN)), false, "the client's own check-in");
  assert.equal(await fails(send(ANN)), true, "a second one the same week");
  // and changes it while it is not reviewed
  assert.equal(await changed(`update public.weekly_checkins set energy = 5, submitted_at = now() where athlete_id = '${ANN}'`), 1, "the client changes their own");
  // but never marks it reviewed
  assert.equal(await fails(`update public.weekly_checkins set reviewed_at = now() where athlete_id = '${ANN}'`), true, "the client marks their own reviewed");
});
// a client who is not in the space sends nothing there
await as(STRANGER, async () => assert.equal(await fails(`insert into public.weekly_checkins (group_id, athlete_id, week_start, energy, eating) values ('${G1}', '${STRANGER}', '${MONDAY}', 3, 3)`), true, "someone outside the space"));
// another client cannot read or change it
await as(BO, async () => {
  assert.equal((await db.query(`select count(*)::int n from public.weekly_checkins`)).rows[0].n, 0, "another client reads it");
  assert.equal(await changed(`update public.weekly_checkins set energy = 1`), 0, "another client changes it");
});

// a coach of another space, and someone signed out, see nothing and change nothing
await as(OTHER_COACH, async () => {
  assert.equal((await db.query(`select count(*)::int n from public.weekly_checkins`)).rows[0].n, 0, "a coach of another space reads it");
  assert.equal(await changed(`update public.weekly_checkins set reviewed_at = now()`), 0, "a coach of another space reviews it");
});
await as(null, async () => assert.equal(await fails(`select * from public.weekly_checkins`), true, "signed out"), "anon");

// the space's coach reads it, cannot change what the client sent, cannot link someone else's message, and marks it reviewed with their own reply
const id = (await db.query(`select id from public.weekly_checkins where athlete_id = '${ANN}'`)).rows[0].id;
await db.exec(`insert into public.direct_messages (id, group_id, sender_id, recipient_id, body) values
  ('77777777-0000-0000-0000-000000000001', '${G1}', '${COACH}', '${ANN}', 'Great week'),
  ('77777777-0000-0000-0000-000000000002', '${G1}', '${COACH}', '${BO}', 'Not for Ann')`);
await as(COACH, async () => {
  const row = (await db.query(`select energy, eating, win from public.weekly_checkins where id = '${id}'`)).rows[0];
  assert.deepEqual(row, { energy: 5, eating: 2, win: "Hit every session" }, "the coach reads what was sent");
  assert.equal(await fails(`update public.weekly_checkins set energy = 1 where id = '${id}'`), true, "the coach changes the client's answer");
  assert.equal(await fails(`update public.weekly_checkins set reviewed_at = now(), reply_message_id = '77777777-0000-0000-0000-000000000002' where id = '${id}'`), true, "a reply sent to someone else");
  assert.equal(await changed(`update public.weekly_checkins set reviewed_at = '2000-01-01', reviewed_by = '${BO}', reply_message_id = '77777777-0000-0000-0000-000000000001' where id = '${id}'`), 1, "the coach marks it reviewed");
  const after = (await db.query(`select reviewed_by, reviewed_at > now() - interval '1 minute' as fresh from public.weekly_checkins where id = '${id}'`)).rows[0];
  assert.deepEqual(after, { reviewed_by: COACH, fresh: true }, "the review time and reviewer are the database's");
  assert.equal(await fails(`update public.weekly_checkins set reviewed_at = null where id = '${id}'`), true, "a review taken back");
});
// once reviewed, the client's changes go nowhere
await as(ANN, async () => {
  assert.equal(await changed(`update public.weekly_checkins set energy = 1 where id = '${id}'`), 0, "the client changes a reviewed check-in");
  assert.equal((await db.query(`select energy from public.weekly_checkins where id = '${id}'`)).rows[0].energy, 5, "it is as it was");
  assert.equal(await fails(`delete from public.weekly_checkins where id = '${id}'`), true, "the client deletes it");
});
await as(COACH, async () => assert.equal(await fails(`delete from public.weekly_checkins where id = '${id}'`), true, "the coach deletes it"));

// the new notice type is allowed and is switched with Client activity
await db.exec(`insert into public.notifications (profile_id, group_id, type, body) values ('${COACH}', '${G1}', 'weekly_checkin', 'Ann sent her weekly check-in.')`);
assert.equal((await db.query(`select public.notice_kind_of('weekly_checkin') k`)).rows[0].k, "client_activity");
assert.equal((await db.query(`select public.notice_kind_of('comment') k`)).rows[0].k, "messages", "the existing list is kept");

// scans: only the server writes or reads them; a coach counts their own machines only
await as(COACH, async () => {
  assert.equal(await fails(`insert into public.qr_scans (machine_id) values ('${M1}')`), true, "a signed-in person writes a scan");
  assert.equal(await fails(`select * from public.qr_scans`), true, "a signed-in person reads the scans");
});
await as(null, async () => assert.equal(await fails(`insert into public.qr_scans (machine_id) values ('${M1}')`), true, "signed out writes a scan"), "anon");
await db.exec(`insert into public.qr_scans (machine_id, scanned_at) values ('${M1}', now()), ('${M1}', now() - interval '40 days'), ('${M2}', now())`);
assert.equal(await fails(`insert into public.qr_scans (machine_id, exercise_id) values ('${M1}', gen_random_uuid())`), true, "a scan is of one code");
await as(COACH, async () => {
  const rows = (await db.query(`select machine_id, since_count::int s, total_count::int t from public.count_machine_scans(now() - interval '20 days')`)).rows;
  assert.deepEqual(rows, [{ machine_id: M1, s: 1, t: 2 }], "the coach's own machine only, this month and in all");
});
await as(STRANGER, async () => assert.equal((await db.query(`select count(*)::int n from public.count_machine_scans(now())`)).rows[0].n, 0, "someone with no machines"));

// the goal sheet has its reviewed date
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'client_goal_sheets' and column_name = 'reviewed_at'`)).rows[0].n, 1);

// the undo takes it away
await db.exec(undo);
await db.exec(undo);
for (const t of ["weekly_checkins", "qr_scans"]) assert.equal((await db.query(`select count(*)::int n from information_schema.tables where table_name = '${t}'`)).rows[0].n, 0, `${t} removed`);
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'client_goal_sheets' and column_name = 'reviewed_at'`)).rows[0].n, 0, "reviewed_at removed");
assert.equal((await db.query(`select public.notice_kind_of('weekly_checkin') k`)).rows[0].k, null, "the switch list is back to 0423's");
assert.equal(await fails(`insert into public.notifications (type) values ('weekly_checkin')`), true, "the type is gone");
assert.equal(await fails(`insert into public.notifications (type) values ('goal_answered')`), false, "the other types stay");

console.log("weekly-checkins: all checks passed");
