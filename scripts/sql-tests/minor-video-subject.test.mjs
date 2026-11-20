// Step 211 (migration 0455) in an in-memory Postgres set up like the live tables it touches: the paste runs (and runs again) and its check row is all true; a coach can no longer
// save a form-check video or send a video check-in for a 13 to 17-year-old with no parent consent on file, can once consent is on file, and can for an adult or a client with
// no date of birth; an under-13 is never filmed; the client's own upload is unchanged (minor_may_write still rules it); someone who does not coach the person learns nothing;
// a filmed shared-list demo needs the on-camera tick, a YouTube link does not; nobody signed in writes or deletes a video report and only the admin reads one; the undo takes
// it all away. Run: node scripts/sql-tests/minor-video-subject.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8").split("\r\n").join("\n");
const paste = file("apply/apply-step211-0455.sql");
const undo = file("apply/undo-step211-0455.sql");
const RON = "11111111-1111-1111-1111-111111111111";
const COACH = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const TEEN = "44444444-4444-4444-4444-444444444444";
const ADULT = "55555555-5555-5555-5555-555555555555";
const KID = "66666666-6666-6666-6666-666666666666";
const NODOB = "77777777-7777-7777-7777-777777777777";
const G1 = "99999999-0000-0000-0000-000000000001";
const G2 = "99999999-0000-0000-0000-000000000002";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, is_platform_admin boolean not null default false);
  insert into public.profiles values ('${RON}', true), ('${COACH}', false), ('${OTHER}', false), ('${TEEN}', false), ('${ADULT}', false), ('${KID}', false), ('${NODOB}', false);
  create function public.is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false); $$;
  create table public.group_memberships (group_id uuid not null, profile_id uuid not null, role text not null);
  insert into public.group_memberships values ('${G1}', '${COACH}', 'coach'), ('${G1}', '${TEEN}', 'athlete'), ('${G1}', '${ADULT}', 'athlete'), ('${G1}', '${KID}', 'athlete'), ('${G1}', '${NODOB}', 'athlete'), ('${G2}', '${OTHER}', 'coach');
  create function public.is_group_coach(g uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.group_memberships where group_id = g and profile_id = auth.uid() and role = 'coach') $$;
  create function public.age_threshold_date(dob date, years int) returns date language sql immutable as $$ select (dob + make_interval(years => years))::date $$;
  create table public.client_intake (athlete_id uuid primary key, date_of_birth date);
  insert into public.client_intake values ('${TEEN}', current_date - interval '15 years'), ('${ADULT}', current_date - interval '30 years'), ('${KID}', current_date - interval '10 years');
  create table public.athlete_profile_details (athlete_id uuid primary key, birthday date);
  create table public.guardian_consents (athlete_id uuid not null, status text not null);
  create table public.guardian_coach_confirmations (athlete_id uuid not null);
  -- the client's own-upload rule as it is live, reduced to what this test needs: a client under 18 needs consent
  create function public.minor_may_write(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
    select not exists (select 1 from public.client_intake i where i.athlete_id = p_user and i.date_of_birth > current_date - interval '18 years')
        or exists (select 1 from public.guardian_consents where athlete_id = p_user and status = 'signed') $$;
  create table public.session_exercise_videos (id uuid primary key default gen_random_uuid(), athlete_id uuid not null, group_id uuid not null, video_path text not null);
  alter table public.session_exercise_videos enable row level security;
  create policy videos_write_own_or_coach on public.session_exercise_videos for all to authenticated using (athlete_id = auth.uid() or public.is_group_coach(group_id)) with check (athlete_id = auth.uid() or public.is_group_coach(group_id));
  create policy minor_write_guard_insert on public.session_exercise_videos as restrictive for insert to authenticated with check (public.minor_may_write(auth.uid()));
  grant select, insert, update, delete on public.session_exercise_videos to authenticated;
  create table public.coach_video_checkins (id uuid primary key default gen_random_uuid(), athlete_id uuid, group_id uuid not null, video_path text not null);
  alter table public.coach_video_checkins enable row level security;
  create policy video_checkins_write_coach on public.coach_video_checkins for all to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
  grant select, insert, update, delete on public.coach_video_checkins to authenticated;
  create table public.exercise_library (id uuid primary key default gen_random_uuid(), video_path text, youtube_url text);
  create table public.gym_machines (id uuid primary key default gen_random_uuid());
  create table public.catalog_machine_exercises (id uuid primary key default gen_random_uuid());
  create table public.catalog_requests (id uuid primary key default gen_random_uuid(), submitted_by uuid not null, kind text not null, video_path text, youtube_url text, rights_confirmed boolean not null default false);
  alter table public.catalog_requests enable row level security;
  create policy catalog_requests_send_own on public.catalog_requests for insert to authenticated with check (submitted_by = auth.uid());
  grant select, insert on public.catalog_requests to authenticated;
`);

const as = async (who, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${who}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
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
const coachVideo = (athlete) => `insert into public.session_exercise_videos (athlete_id, group_id, video_path) values ('${athlete}', '${G1}', '${G1}/x/v.mp4')`;
const checkin = (athlete) => `insert into public.coach_video_checkins (athlete_id, group_id, video_path) values ('${athlete}', '${G1}', '${G1}/${athlete}/c.webm')`;

// the paste runs, twice, and its check row is all true
await db.exec(paste.slice(0, paste.indexOf("-- check: one row")));
await db.exec(paste.slice(0, paste.indexOf("-- check: one row")));
const check = (await db.query(paste.slice(paste.indexOf("-- check: one row")))).rows[0];
for (const [k, v] of Object.entries(check)) assert.equal(v, true, `check row: ${k}`);

// a coach filming a 15-year-old with no consent on file: refused (form check and check-in)
await as(COACH, async () => {
  assert.equal(await fails(coachVideo(TEEN)), true, "coach upload of a minor without consent");
  assert.equal(await fails(checkin(TEEN)), true, "check-in to a minor without consent");
  // an adult and a client with no date of birth: as before
  assert.equal(await fails(coachVideo(ADULT)), false, "adult");
  assert.equal(await fails(checkin(NODOB)), false, "no date of birth on file");
  // under 13: never
  assert.equal(await fails(coachVideo(KID)), true, "under 13");
});
// with the parent's signature on file: allowed
await db.exec(`insert into public.guardian_consents values ('${TEEN}', 'signed')`);
await as(COACH, async () => {
  assert.equal(await fails(coachVideo(TEEN)), false, "minor with consent");
  assert.equal(await fails(checkin(TEEN)), false, "check-in with consent");
});
// the coach's word that they talked with the parent counts too (another minor)
await db.exec(`delete from public.guardian_consents; insert into public.guardian_coach_confirmations values ('${TEEN}')`);
await as(COACH, async () => assert.equal(await fails(checkin(TEEN)), false, "coach confirmation"));
await db.exec(`delete from public.guardian_coach_confirmations`);

// the client's own upload: still minor_may_write's rule (refused without consent), the subject guard does not add to it
await as(TEEN, async () => assert.equal(await fails(`insert into public.session_exercise_videos (athlete_id, group_id, video_path) values ('${TEEN}', '${G1}', 'x')`), true, "own upload without consent"));
await as(ADULT, async () => assert.equal(await fails(`insert into public.session_exercise_videos (athlete_id, group_id, video_path) values ('${ADULT}', '${G1}', 'y')`), false, "adult's own upload"));

// someone who does not coach the person learns nothing (false for an adult too)
await as(OTHER, async () => {
  const r = await db.query(`select public.minor_subject_ok('${ADULT}') a, public.minor_subject_ok('${TEEN}') t`);
  assert.deepEqual(r.rows[0], { a: false, t: false });
});

// on-camera consent: a filmed demo needs it, a YouTube link does not
await as(COACH, async () => {
  assert.equal(await fails(`insert into public.catalog_requests (submitted_by, kind, video_path, rights_confirmed) values ('${COACH}', 'demo', '${COACH}/a.mp4', true)`), true, "filmed without consent tick");
  assert.equal(await fails(`insert into public.catalog_requests (submitted_by, kind, video_path, rights_confirmed, subject_consent) values ('${COACH}', 'demo', '${COACH}/a.mp4', true, true)`), false, "filmed with the tick");
  assert.equal(await fails(`insert into public.catalog_requests (submitted_by, kind, youtube_url, rights_confirmed) values ('${COACH}', 'demo', 'https://youtu.be/x', true)`), false, "YouTube link");
});

// reports: the server writes, nobody signed in writes or deletes, only the admin reads and closes
await db.exec(`insert into public.video_reports (reason) values ('not_agreed')`);
await as(COACH, async () => {
  assert.equal(await fails(`insert into public.video_reports (reason) values ('other')`), true, "a coach writes a report directly");
  assert.equal((await db.query(`select count(*)::int n from public.video_reports`)).rows[0].n, 0, "a coach reads reports");
});
await as(RON, async () => {
  assert.equal((await db.query(`select count(*)::int n from public.video_reports`)).rows[0].n, 1, "the admin reads reports");
  await db.exec(`update public.video_reports set status = 'dismissed', closed_at = now()`);
  assert.equal(await fails(`delete from public.video_reports`), true, "nobody deletes a report");
});

// the undo takes it away
await db.exec(undo);
assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = 'minor_subject_ok'`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from information_schema.tables where table_name = 'video_reports'`)).rows[0].n, 0);
await as(COACH, async () => assert.equal(await fails(coachVideo(TEEN)), false, "after the undo, as before"));

console.log("minor video subject + demo reports: ok");
