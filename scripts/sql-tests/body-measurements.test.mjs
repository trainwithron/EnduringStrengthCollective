// Migration 0457 / paste step 213 (tape measurements) in an in-memory Postgres, with stand-ins for the live helpers it uses (is_group_coach, minor_may_write,
// enforce_athlete_in_group, group_in_active_org: the same rules as their live definitions, read Nov 20): the paste runs (and runs again) to a check row of all
// true; a client writes and reads their own, their coach writes and reads them, another coach and another client see nothing, a signed-out person nothing; a
// minor without a guardian's word cannot write; one row a day, at least one value, sane sizes; the person must be in the group; the org wall holds; the undo
// removes it. Run: node scripts/sql-tests/body-measurements.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8").split("\r\n").join("\n");
const paste = file("apply/apply-step213-0457.sql");
const undo = file("apply/undo-step213-0457.sql");
assert.ok(paste.includes(file("migrations/0457_body_measurements.sql").trimEnd()), "the paste carries the migration as written");

const COACH = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const OTHER_COACH = "33333333-3333-3333-3333-333333333333";
const OTHER_CLIENT = "44444444-4444-4444-4444-444444444444";
const MINOR = "55555555-5555-5555-5555-555555555555";
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_GROUP = "aaaaaaaa-0000-0000-0000-000000000002";
const WALLED_GROUP = "aaaaaaaa-0000-0000-0000-000000000003";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select case when nullif(current_setting('request.jwt.claim.sub', true), '') is null then 'anon' else 'authenticated' end $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table public.profiles (id uuid primary key);
  insert into public.profiles values ('${COACH}'), ('${CLIENT}'), ('${OTHER_COACH}'), ('${OTHER_CLIENT}'), ('${MINOR}');
  create table public.groups (id uuid primary key);
  insert into public.groups values ('${GROUP}'), ('${OTHER_GROUP}'), ('${WALLED_GROUP}');
  create table public.group_memberships (group_id uuid references public.groups(id), profile_id uuid references public.profiles(id), role text);
  insert into public.group_memberships values
    ('${GROUP}', '${COACH}', 'coach'), ('${GROUP}', '${CLIENT}', 'athlete'), ('${GROUP}', '${MINOR}', 'athlete'),
    ('${OTHER_GROUP}', '${OTHER_COACH}', 'coach'), ('${OTHER_GROUP}', '${OTHER_CLIENT}', 'athlete'),
    ('${WALLED_GROUP}', '${COACH}', 'coach'), ('${WALLED_GROUP}', '${CLIENT}', 'athlete');
  -- who has no guardian's word on file (the live minor_may_write reads the intake date of birth and the consents; here one flag stands in for its answer)
  create table public.minors_without_consent (profile_id uuid primary key);
  insert into public.minors_without_consent values ('${MINOR}');
  -- the organization the request is working in (the live wall reads a request header); here the walled group is outside it
  create table public.outside_active_org (group_id uuid primary key);
  insert into public.outside_active_org values ('${WALLED_GROUP}');

  create function public.is_group_coach(_group_id uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = auth.uid() and role = 'coach') $$;
  create function public.minor_may_write(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
    select p_user is not null and p_user = auth.uid() and not exists (select 1 from public.minors_without_consent where profile_id = p_user) $$;
  create function public.group_in_active_org(_group_id uuid) returns boolean language sql stable security definer set search_path = public as $$
    select not exists (select 1 from public.outside_active_org where group_id = _group_id) $$;
  create function public.enforce_athlete_in_group() returns trigger language plpgsql security definer set search_path = public as $$
  begin
    if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
    if exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.athlete_id) then return new; end if;
    raise exception 'That person is not a member of this group.' using errcode = '42501';
  end $$;
  grant execute on all functions in schema public to anon, authenticated;
`);

const checkRow = async () => {
  const res = await db.query(paste.slice(paste.indexOf("-- Check: one row, all true.")));
  assert.equal(res.rows.length, 1);
  return res.rows[0];
};
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true), JSON.stringify(await checkRow()));
assert.equal(Object.keys(await checkRow()).length, 8);
await db.exec(paste); // re-running is safe
assert.ok(Object.values(await checkRow()).every((v) => v === true));

async function as(user, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}
const fails = (user, sql) => assert.rejects(() => as(user, sql));
const count = async (user, where = "true") => (await as(user, `select count(*)::int n from public.body_measurements where ${where}`)).rows[0].n;

// the client writes their own; the coach writes one for them on another day; entered_by says who
await as(CLIENT, `insert into public.body_measurements (athlete_id, group_id, measured_on, waist_in, hips_in) values ('${CLIENT}', '${GROUP}', '2026-11-01', 34.5, 40)`);
await as(COACH, `insert into public.body_measurements (athlete_id, group_id, measured_on, arm_in) values ('${CLIENT}', '${GROUP}', '2026-11-08', 15.25)`);
const rows = (await as(CLIENT, `select measured_on::text d, waist_in::float w, arm_in::float a, entered_by from public.body_measurements order by measured_on`)).rows;
assert.deepEqual(rows.map((r) => [r.d, r.w, r.a, r.entered_by]), [["2026-11-01", 34.5, null, CLIENT], ["2026-11-08", null, 15.25, COACH]]);
assert.equal(await count(COACH), 2);

// nobody else reads or writes them
assert.equal(await count(OTHER_COACH), 0);
assert.equal(await count(OTHER_CLIENT), 0);
await fails(null, `select * from public.body_measurements`);
await fails(OTHER_COACH, `insert into public.body_measurements (athlete_id, group_id, waist_in) values ('${CLIENT}', '${GROUP}', 30)`);
await fails(OTHER_CLIENT, `insert into public.body_measurements (athlete_id, group_id, waist_in) values ('${CLIENT}', '${GROUP}', 30)`);
assert.equal((await as(OTHER_CLIENT, `update public.body_measurements set waist_in = 20 returning id`)).rows.length, 0);
assert.equal((await as(OTHER_COACH, `delete from public.body_measurements returning id`)).rows.length, 0);

// the client changes theirs (updated_at moves), and one row a day
await as(CLIENT, `update public.body_measurements set chest_in = 41 where measured_on = '2026-11-01'`);
assert.equal((await as(CLIENT, `select chest_in::float c from public.body_measurements where measured_on = '2026-11-01'`)).rows[0].c, 41);
await fails(CLIENT, `insert into public.body_measurements (athlete_id, group_id, measured_on, waist_in) values ('${CLIENT}', '${GROUP}', '2026-11-01', 34)`);

// at least one value, and sizes a tape could read
await fails(CLIENT, `insert into public.body_measurements (athlete_id, group_id, measured_on) values ('${CLIENT}', '${GROUP}', '2026-11-15')`);
await fails(CLIENT, `insert into public.body_measurements (athlete_id, group_id, measured_on, waist_in) values ('${CLIENT}', '${GROUP}', '2026-11-15', 400)`);
await fails(CLIENT, `insert into public.body_measurements (athlete_id, group_id, measured_on, arm_in) values ('${CLIENT}', '${GROUP}', '2026-11-15', 1)`);

// the person must be in the group it is filed under
await fails(COACH, `insert into public.body_measurements (athlete_id, group_id, waist_in) values ('${OTHER_CLIENT}', '${GROUP}', 30)`);

// a minor without a guardian's word cannot write; their coach still can
await fails(MINOR, `insert into public.body_measurements (athlete_id, group_id, waist_in) values ('${MINOR}', '${GROUP}', 28)`);
await as(COACH, `insert into public.body_measurements (athlete_id, group_id, waist_in) values ('${MINOR}', '${GROUP}', 28)`);
assert.equal(await count(MINOR), 1);

// the org wall: a row filed in a group outside the organization being worked in is neither read nor written there
await db.exec(`insert into public.body_measurements (athlete_id, group_id, measured_on, thigh_in) values ('${CLIENT}', '${WALLED_GROUP}', '2026-10-01', 24)`);
assert.equal(await count(COACH, `group_id = '${WALLED_GROUP}'`), 0);
await fails(COACH, `insert into public.body_measurements (athlete_id, group_id, measured_on, thigh_in) values ('${CLIENT}', '${WALLED_GROUP}', '2026-10-02', 24)`);

// the client deletes their own
assert.equal((await as(CLIENT, `delete from public.body_measurements where measured_on = '2026-11-08' returning id`)).rows.length, 1);

// the undo takes it all away, and the paste can go in again
await db.exec(undo);
assert.equal((await db.query(`select to_regclass('public.body_measurements') is null as gone`)).rows[0].gone, true);
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true));

console.log("body measurements: ok");
