// Rehearses step 230 (migration 0474, Ron Nov 24: a coach confirms a client with no birthday on file is 18 or older). On an in-memory Postgres with stand-ins shaped like live
// (the four live age checks exactly as they are, md5 checked, and the tables they read): the paste and its check row, run twice (re-running is safe), the rule (no birthday +
// confirmation = adult; any birthday under 18 wins), who may tick it and who may ask, Ron's clients confirmed, then the undo (the four checks exactly as before) and the paste again.
//   node scripts/sql-tests/coach-confirmed-adult.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, LF);
const db = new PGlite();
const failures = [];
let checks = 0;
const expect = (name, cond, extra = "") => {
  checks += 1;
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};

const RON = "136394ed-f108-4283-bcb7-310a1ac6cbc8";
const OTHER_COACH = "00000000-0000-0000-0000-0000000000c2";
const NO_DOB = "00000000-0000-0000-0000-00000000000a"; // Ron's client, no birthday anywhere
const NO_DOB_2 = "00000000-0000-0000-0000-00000000000b"; // Ron's client, no birthday, an adult profile birthday
const TEEN = "00000000-0000-0000-0000-00000000000c"; // Ron's client, a birthday that says 15
const ADULT = "00000000-0000-0000-0000-00000000000d"; // Ron's client, a birthday that says 30
const YOUNG_PROFILE = "00000000-0000-0000-0000-00000000000e"; // Ron's client, no intake birthday, a profile birthday that says 16
const STRANGER = "00000000-0000-0000-0000-00000000000f"; // another coach's client, no birthday
const G_RON = "00000000-0000-0000-0000-0000000000a1";
const G_OTHER = "00000000-0000-0000-0000-0000000000a2";

const LIVE_MD5 = {
  minor_may_write: "4ce90722aeaf6b38d53f56a86f231d9f",
  minor_subject_ok: "d67ec0667c1284d0e24afd70c874a468",
  notice_display_name: "2251b9649248307314e2d07596444258",
  training_partner_intake_incomplete: "23603214443916629981a3cee33125e6",
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, full_name text);
  create table public.groups (id uuid primary key, archived_at timestamptz);
  create table public.group_memberships (group_id uuid, profile_id uuid, role text, membership_type text not null default 'training');
  create table public.client_intake (athlete_id uuid primary key, date_of_birth date);
  create table public.athlete_profile_details (athlete_id uuid primary key, birthday date);
  create table public.organization_memberships (profile_id uuid, role text);
  create table public.org_front_desk (profile_id uuid);
  create table public.guardian_consents (athlete_id uuid, status text);
  create table public.guardian_coach_confirmations (athlete_id uuid primary key);
  create function public.is_group_coach(g uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.group_memberships where group_id = g and profile_id = auth.uid() and role = 'coach') $$;
  create or replace function public.age_threshold_date(p_dob date, p_years integer) returns date language sql immutable set search_path = public as $$
    select make_date((extract(year from p_dob))::int + p_years, (extract(month from p_dob))::int, 1) + ((extract(day from p_dob))::int - 1)
  $$;
`);

// The four live age checks: the undo puts back exactly these bodies (their md5 is checked here, and again after the undo).
const undoSql = read("../../supabase/apply/undo-step230-0474.sql");
const undoBody = undoSql.slice(undoSql.indexOf("begin;") + "begin;".length, undoSql.indexOf("drop function if exists public.set_adult_confirmed"));
await db.exec(undoBody);
const md5Of = async (name) => (await db.query(`select md5(replace(prosrc, chr(13), '')) m from pg_proc where proname = $1`, [name])).rows[0]?.m;
for (const [name, want] of Object.entries(LIVE_MD5)) expect(`the stand-in ${name} is the live one`, (await md5Of(name)) === want, await md5Of(name));

const years = (n) => `(current_date - interval '${n} years')::date`;
await db.exec(`
  insert into public.profiles values ('${RON}', 'Coach Ron'), ('${OTHER_COACH}', 'Other Coach'), ('${NO_DOB}', 'Robyn Lane'), ('${NO_DOB_2}', 'Ward Forrest'), ('${TEEN}', 'Sam Teen'),
    ('${ADULT}', 'Amber Belt'), ('${YOUNG_PROFILE}', 'Pat Young'), ('${STRANGER}', 'Stan Ger');
  insert into public.groups values ('${G_RON}', null), ('${G_OTHER}', null);
  insert into public.group_memberships (group_id, profile_id, role) values
    ('${G_RON}', '${RON}', 'coach'), ('${G_RON}', '${NO_DOB}', 'athlete'), ('${G_RON}', '${NO_DOB_2}', 'athlete'), ('${G_RON}', '${TEEN}', 'athlete'), ('${G_RON}', '${ADULT}', 'athlete'),
    ('${G_RON}', '${YOUNG_PROFILE}', 'athlete'), ('${G_OTHER}', '${OTHER_COACH}', 'coach'), ('${G_OTHER}', '${STRANGER}', 'athlete');
  insert into public.client_intake values ('${TEEN}', ${years(15)}), ('${ADULT}', ${years(30)});
  insert into public.athlete_profile_details values ('${NO_DOB_2}', ${years(40)}), ('${YOUNG_PROFILE}', ${years(16)});
`);

async function as(who, role, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false), set_config('request.jwt.claim.role', '${role ?? ""}', false)`);
  if (role === "authenticated" || role === "anon") await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)`);
  }
}
const one = async (who, role, sql) => Object.values((await as(who, role, sql)).rows[0])[0];
const fails = async (who, role, sql) => {
  try {
    await as(who, role, sql);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

// Before the paste: no birthday reads as not an adult everywhere.
expect("before: a client with no birthday may not write", (await one(NO_DOB, "authenticated", `select public.minor_may_write('${NO_DOB}')`)) === false);
expect("before: their name is shortened in a notice", (await one(null, null, `select public.notice_display_name('${NO_DOB}')`)) === "Robyn L.");

const applySql = read("../../supabase/apply/apply-step230-0474.sql");
const checkRow = applySql.slice(applySql.lastIndexOf("select\n  to_regclass"));
async function applyAndCheck(label) {
  await db.exec(applySql.slice(0, applySql.lastIndexOf("-- Check: one row")));
  const row = (await db.query(checkRow)).rows[0];
  for (const [k, v] of Object.entries(row)) if (k !== "ron_confirmed") expect(`${label}: ${k}`, v === true, String(v));
  return Number(row.ron_confirmed);
}
const firstCount = await applyAndCheck("paste");
// Ron's clients with no birthday: NO_DOB and NO_DOB_2 (an adult profile birthday). Not TEEN or ADULT (a birthday on file), not YOUNG_PROFILE (a profile birthday under 18), not STRANGER (not Ron's).
expect("paste: confirms exactly Ron's clients with no birthday", firstCount === 2, String(firstCount));
const confirmed = (await db.query(`select athlete_id from public.client_adult_confirmations order by athlete_id`)).rows.map((r) => r.athlete_id);
expect("paste: the two right clients", JSON.stringify(confirmed) === JSON.stringify([NO_DOB, NO_DOB_2].sort()), JSON.stringify(confirmed));
expect("paste run again: safe, nobody added twice", (await applyAndCheck("paste again")) === 2);

// The rule.
const rule = async (id) => one(null, null, `select public.coach_confirmed_adult('${id}')`);
expect("confirmed with no birthday = adult", (await rule(NO_DOB)) === true);
expect("not confirmed = not an adult", (await rule(STRANGER)) === false);
await db.exec(`insert into public.client_adult_confirmations (athlete_id) values ('${TEEN}'), ('${YOUNG_PROFILE}')`);
expect("a birthday under 18 wins over a confirmation", (await rule(TEEN)) === false);
expect("a profile birthday under 18 wins too", (await rule(YOUNG_PROFILE)) === false);
await db.exec(`delete from public.client_adult_confirmations where athlete_id in ('${TEEN}', '${YOUNG_PROFILE}')`);

// The four age checks follow it.
expect("a confirmed client may write", (await one(NO_DOB, "authenticated", `select public.minor_may_write('${NO_DOB}')`)) === true);
expect("an unconfirmed one with no birthday still may not", (await one(STRANGER, "authenticated", `select public.minor_may_write('${STRANGER}')`)) === false);
expect("the teen still needs a guardian", (await one(TEEN, "authenticated", `select public.minor_may_write('${TEEN}')`)) === false);
expect("a video of a confirmed client is fine for their coach", (await one(RON, "authenticated", `select public.minor_subject_ok('${NO_DOB}')`)) === true);
expect("a video of an unconfirmed client with no birthday still needs a parent", (await one(OTHER_COACH, "authenticated", `select public.minor_subject_ok('${STRANGER}')`)) === false);
expect("a confirmed client's full name in a notice", (await one(null, null, `select public.notice_display_name('${NO_DOB}')`)) === "Robyn Lane");
expect("an unconfirmed one stays shortened", (await one(null, null, `select public.notice_display_name('${STRANGER}')`)) === "Stan G.");
expect("a confirmed client is not 'intake incomplete' for partner matching", (await one(null, null, `select public.training_partner_intake_incomplete('${NO_DOB}')`)) === false);
expect("an unconfirmed one still is", (await one(null, null, `select public.training_partner_intake_incomplete('${STRANGER}')`)) === true);

// Who may tick it, and who may ask.
expect("a signed-in person cannot read the table", !!(await fails(RON, "authenticated", `select * from public.client_adult_confirmations`)));
expect("nor write it", !!(await fails(RON, "authenticated", `insert into public.client_adult_confirmations (athlete_id) values ('${STRANGER}')`)));
expect("nor call the rule directly", !!(await fails(RON, "authenticated", `select public.coach_confirmed_adult('${NO_DOB}')`)));
expect("another coach cannot tick Ron's client", /not authorized/.test((await fails(OTHER_COACH, "authenticated", `select public.set_adult_confirmed('${NO_DOB}', false)`)) ?? ""));
expect("a client cannot tick themself", /not authorized/.test((await fails(STRANGER, "authenticated", `select public.set_adult_confirmed('${STRANGER}', true)`)) ?? ""));
expect("a coach cannot tick a client with a birthday on file", /birthday on file/.test((await fails(RON, "authenticated", `select public.set_adult_confirmed('${ADULT}', true)`)) ?? ""));
expect("the coach can tick their own client", (await fails(OTHER_COACH, "authenticated", `select public.set_adult_confirmed('${STRANGER}', true)`)) === null);
expect("and it is recorded in their name", (await one(null, null, `select confirmed_by::text from public.client_adult_confirmations where athlete_id = '${STRANGER}'`)) === OTHER_COACH);
expect("and untick it", (await fails(OTHER_COACH, "authenticated", `select public.set_adult_confirmed('${STRANGER}', false)`)) === null && (await rule(STRANGER)) === false);
const idsFor = async (who, role) => (await as(who, role, `select x::text from public.confirmed_adult_ids(array['${NO_DOB}', '${NO_DOB_2}', '${STRANGER}']::uuid[]) x order by 1`)).rows.map((r) => r.x);
expect("the coach is told about their own clients", JSON.stringify(await idsFor(RON, "authenticated")) === JSON.stringify([NO_DOB, NO_DOB_2].sort()));
expect("another coach is told nothing about them", (await idsFor(OTHER_COACH, "authenticated")).length === 0);
expect("a client is told about themself only", JSON.stringify(await idsFor(NO_DOB, "authenticated")) === JSON.stringify([NO_DOB]));
expect("the server is told everything", (await idsFor(null, "service_role")).length === 2);
expect("anon may not ask", !!(await fails(null, "anon", `select * from public.confirmed_adult_ids(array['${NO_DOB}']::uuid[])`)));

// The undo, then the paste again.
await db.exec(undoSql.slice(0, undoSql.lastIndexOf("-- Check: one row")));
const undoRow = (await db.query(undoSql.slice(undoSql.lastIndexOf("select\n  to_regclass")))).rows[0];
for (const [k, v] of Object.entries(undoRow)) expect(`undo: ${k}`, v === true, String(v));
for (const [name, want] of Object.entries(LIVE_MD5)) expect(`undo: ${name} is the live one again`, (await md5Of(name)) === want);
expect("undo: no birthday is not an adult again", (await one(NO_DOB, "authenticated", `select public.minor_may_write('${NO_DOB}')`)) === false);
expect("paste after the undo", (await applyAndCheck("paste after undo")) === 2);

if (failures.length > 0) {
  console.error("FAIL: step 230 rehearsal");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK: step 230 rehearsal passed (${checks} checks)`);
