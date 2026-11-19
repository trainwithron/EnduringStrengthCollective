// Migration 0453 (the shared machine list with Ron's approval) in an in-memory Postgres, set up the way the live tables are today (exercise_catalog, exercise_library, 0451's
// machines, the platform admin flag, storage): the paste runs (and runs again), every signed-in coach reads the shared list and only the admin changes it, a coach sends requests
// (and reads only their own), only the admin's review publishes (a machine with its exercises, then a demo), a denial publishes nothing, the video bucket is private until a video
// is on the list, nobody signed out reads any of it, and the undo takes it away. Run: node scripts/sql-tests/machine-catalog.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8").split("\r\n").join("\n");
const paste = file("apply/apply-step208-0453.sql");
const undo = file("apply/undo-step208-0453.sql");
const RON = "11111111-1111-1111-1111-111111111111";
const COACH = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const SHRUG = "aaaaaaaa-0000-0000-0000-000000000001";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table public.profiles (id uuid primary key, is_platform_admin boolean not null default false);
  insert into public.profiles values ('${RON}', true), ('${COACH}', false), ('${OTHER}', false);
  grant select on public.profiles to authenticated;
  create function public.is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false); $$;
  create table public.organizations (id uuid primary key default gen_random_uuid());
  create function public.is_org_member(p uuid) returns boolean language sql stable as $$ select true $$;
  create table public.exercise_catalog (id uuid primary key default gen_random_uuid(), name text not null check (char_length(btrim(name)) between 1 and 120), category text, equipment text, batch text, created_at timestamptz not null default now());
  create unique index exercise_catalog_name_key on public.exercise_catalog (lower(name));
  alter table public.exercise_catalog enable row level security;
  create policy exercise_catalog_read on public.exercise_catalog for select using (true);
  grant select on public.exercise_catalog to authenticated;
  insert into public.exercise_catalog (id, name) values ('${SHRUG}', 'Dumbbell Shrug');
  create table public.exercise_library (id uuid primary key default gen_random_uuid(), created_by uuid not null references public.profiles(id), name text not null, catalog_id uuid references public.exercise_catalog(id), video_path text, youtube_url text);
  alter table public.exercise_library enable row level security;
  create policy exercise_library_own on public.exercise_library for all to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
  grant select, insert, update, delete on public.exercise_library to authenticated;
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant execute on function storage.foldername(text) to anon, authenticated;
  alter table storage.objects enable row level security;
  grant select, insert on storage.objects to anon, authenticated;
`);
await db.exec(file("migrations/0451_gym_machines.sql"));

const checkRow = async () => {
  const res = await db.query(paste.slice(paste.indexOf("-- Check: one row, all true.")));
  assert.equal(res.rows.length, 1);
  return res.rows[0];
};
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true), JSON.stringify(await checkRow()));
assert.equal(Object.keys(await checkRow()).length, 7);
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
const fails = (user, sql, re) => assert.rejects(() => as(user, sql), re);
const n = async (user, sql) => (await as(user, sql)).rows[0].n;

// only the admin writes the shared list directly
await fails(COACH, `insert into public.catalog_machines (brand, model) values ('Bolt', 'Viking Press')`);
await as(RON, `insert into public.catalog_machines (brand, model) values ('Hammer Strength', 'Plate-Loaded Row')`);
assert.equal(await n(COACH, `select count(*)::int n from public.catalog_machines`), 1);
await fails(null, `select * from public.catalog_machines`);

// a coach sends a new machine; only they and the admin read it; nobody can mark their own approved
await fails(COACH, `insert into public.catalog_requests (submitted_by, kind, brand, model, exercises, status) values ('${COACH}', 'machine', 'Bolt', 'Viking Press', '[{"name": "Viking Press"}]', 'approved')`);
await fails(COACH, `insert into public.catalog_requests (submitted_by, kind, brand, model, exercises) values ('${OTHER}', 'machine', 'Bolt', 'Viking Press', '[{"name": "Viking Press"}]')`);
await fails(COACH, `insert into public.catalog_requests (kind, brand, model, exercises) values ('machine', 'Bolt', 'Viking Press', '[]')`);
const req = (await as(COACH, `insert into public.catalog_requests (kind, brand, model, exercises) values ('machine', ' Bolt ', 'Viking Press', '[{"name": "Viking  Press", "catalogId": null}, {"name": "x", "catalogId": "${SHRUG}"}, {"name": "Viking Press"}]') returning id`)).rows[0].id;
assert.equal(await n(COACH, `select count(*)::int n from public.catalog_requests`), 1);
assert.equal(await n(OTHER, `select count(*)::int n from public.catalog_requests`), 0);
assert.equal(await n(RON, `select count(*)::int n from public.catalog_requests`), 1);
await as(COACH, `update public.catalog_requests set status = 'approved' where id = '${req}'`).catch(() => {});
assert.equal((await db.query(`select status from public.catalog_requests where id = '${req}'`)).rows[0].status, "pending");
await fails(COACH, `select public.review_catalog_request('${req}', true, null)`, /Only the platform admin/);
await fails(null, `select public.review_catalog_request('${req}', true, null)`);

// the admin approves: the machine, its exercises in order (a new name added to the exercise catalog once, a picked catalog exercise used as is)
assert.equal((await as(RON, `select public.review_catalog_request('${req}', true, ' Looks good ') s`)).rows[0].s, "approved");
const items = (await db.query(`select e.id, c.name, e.position from public.catalog_machine_exercises e join public.catalog_machines m on m.id = e.machine_id join public.exercise_catalog c on c.id = e.catalog_exercise_id where m.brand = 'Bolt' order by e.position`)).rows;
assert.deepEqual(items.map((r) => [r.name, r.position]), [["Viking Press", 0], ["Dumbbell Shrug", 1]]);
assert.equal((await db.query(`select review_note, reviewed_at is not null r from public.catalog_requests where id = '${req}'`)).rows[0].review_note, "Looks good");
await fails(RON, `select public.review_catalog_request('${req}', false, null)`, /already reviewed/);
// the same machine sent again adds only the exercises it does not have yet
const again = (await as(OTHER, `insert into public.catalog_requests (kind, brand, model, exercises) values ('machine', 'bolt', 'viking press', '[{"name": "Viking Press"}, {"name": "Z Press"}]') returning id`)).rows[0].id;
await as(RON, `select public.review_catalog_request('${again}', true, null)`);
assert.equal((await db.query(`select count(*)::int n from public.catalog_machines where lower(brand) = 'bolt'`)).rows[0].n, 1);
assert.deepEqual((await db.query(`select c.name from public.catalog_machine_exercises e join public.exercise_catalog c on c.id = e.catalog_exercise_id join public.catalog_machines m on m.id = e.machine_id where m.brand = 'Bolt' order by e.position`)).rows.map((r) => r.name), ["Viking Press", "Dumbbell Shrug", "Z Press"]);

// a demo: needs the tick, a video in the coach's own folder or a YouTube link (not both)
const item = items[0].id;
await fails(COACH, `insert into public.catalog_requests (kind, item_id, video_path) values ('demo', '${item}', '${COACH}/a.mp4')`);
await fails(COACH, `insert into public.catalog_requests (kind, item_id, video_path, rights_confirmed) values ('demo', '${item}', '${OTHER}/a.mp4', true)`);
await fails(COACH, `insert into public.catalog_requests (kind, item_id, youtube_url, rights_confirmed) values ('demo', '${item}', 'https://vimeo.com/1', true)`);
await fails(COACH, `insert into public.catalog_requests (kind, item_id, video_path, youtube_url, rights_confirmed) values ('demo', '${item}', '${COACH}/a.mp4', 'https://youtu.be/abc', true)`);
await as(COACH, `insert into storage.objects (bucket_id, name) values ('machine-demos', '${COACH}/a.mp4')`);
await fails(COACH, `insert into storage.objects (bucket_id, name) values ('machine-demos', '${OTHER}/b.mp4')`);
// the waiting video: the coach and the admin read it, nobody else
assert.equal(await n(COACH, `select count(*)::int n from storage.objects where name = '${COACH}/a.mp4'`), 1);
assert.equal(await n(RON, `select count(*)::int n from storage.objects where name = '${COACH}/a.mp4'`), 1);
assert.equal(await n(OTHER, `select count(*)::int n from storage.objects where name = '${COACH}/a.mp4'`), 0);
const denied = (await as(COACH, `insert into public.catalog_requests (kind, item_id, video_path, rights_confirmed) values ('demo', '${item}', '${COACH}/a.mp4', true) returning id`)).rows[0].id;
await as(RON, `select public.review_catalog_request('${denied}', false, 'Too dark')`);
assert.equal((await db.query(`select video_path from public.catalog_machine_exercises where id = '${item}'`)).rows[0].video_path, null);
assert.equal(await n(OTHER, `select count(*)::int n from storage.objects where name = '${COACH}/a.mp4'`), 0);
assert.equal((await as(COACH, `select status, review_note from public.catalog_requests where id = '${denied}'`)).rows[0].review_note, "Too dark");
// approved: on the list, and every signed-in coach can read the video
const ok = (await as(COACH, `insert into public.catalog_requests (kind, item_id, video_path, rights_confirmed) values ('demo', '${item}', '${COACH}/a.mp4', true) returning id`)).rows[0].id;
const yt = (await as(OTHER, `insert into public.catalog_requests (kind, item_id, youtube_url, rights_confirmed) values ('demo', '${item}', 'https://www.youtube.com/watch?v=abc', true) returning id`)).rows[0].id;
await as(RON, `select public.review_catalog_request('${ok}', true, null)`);
await as(RON, `select public.review_catalog_request('${yt}', true, null)`);
const demo = (await db.query(`select video_path, youtube_url from public.catalog_machine_exercises where id = '${item}'`)).rows[0];
assert.deepEqual([demo.video_path, demo.youtube_url], [`${COACH}/a.mp4`, "https://www.youtube.com/watch?v=abc"]);
assert.equal(await n(OTHER, `select count(*)::int n from storage.objects where name = '${COACH}/a.mp4'`), 1);
assert.equal(await n(null, `select count(*)::int n from storage.objects where bucket_id = 'machine-demos'`), 0);

// a coach's machine linked to the shared list; removing it from the list leaves the coach's machine
const gym = (await as(COACH, `insert into public.gym_machines (created_by, name, catalog_machine_id) select '${COACH}', 'Bolt Viking Press', id from public.catalog_machines where brand = 'Bolt' returning id`)).rows[0].id;
const lib = (await as(COACH, `insert into public.exercise_library (created_by, name) values ('${COACH}', 'Viking Press') returning id`)).rows[0].id;
await as(COACH, `insert into public.gym_machine_exercises (machine_id, exercise_id, position, catalog_item_id) values ('${gym}', '${lib}', 0, '${item}')`);
await as(RON, `delete from public.catalog_machines where brand = 'Bolt'`);
assert.equal((await db.query(`select catalog_machine_id from public.gym_machines where id = '${gym}'`)).rows[0].catalog_machine_id, null);
assert.equal((await db.query(`select count(*)::int n from public.gym_machine_exercises where machine_id = '${gym}' and catalog_item_id is null`)).rows[0].n, 1);

// at most 50 waiting requests a coach
await db.exec(`insert into public.catalog_requests (submitted_by, kind, brand, model, exercises) select '${OTHER}', 'machine', 'B', 'M' || g, '[{"name": "X"}]' from generate_series(1, 50) g`);
await fails(OTHER, `insert into public.catalog_requests (kind, brand, model, exercises) values ('machine', 'B', 'One more', '[{"name": "X"}]')`, /50 requests waiting/);

// the undo takes it away; the coach's machine and exercises stay
await db.exec(undo);
assert.equal((await db.query(`select to_regclass('public.catalog_machines') is null and to_regclass('public.catalog_requests') is null gone`)).rows[0].gone, true);
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'gym_machines' and column_name = 'catalog_machine_id'`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.gym_machine_exercises`)).rows[0].n, 1);
assert.equal((await db.query(`select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'machine_demos%'`)).rows[0].n, 0);
await db.exec(paste); // and it can be applied again after the undo
assert.ok(Object.values(await checkRow()).every((v) => v === true));
console.log("machine catalog: ok");
