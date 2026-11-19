// Migration 0451 (gym machines) in an in-memory Postgres: it runs twice, a coach reads and changes only their own machines, a machine holds only their own exercises, and a signed-out
// visitor reads nothing. Run: node scripts/sql-tests/gym-machines.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const migration = readFileSync(new URL("../../supabase/migrations/0451_gym_machines.sql", import.meta.url), "utf8").split("\r\n").join("\n");
const RON = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key);
  create table public.exercise_library (id uuid primary key default gen_random_uuid(), created_by uuid not null references public.profiles(id), name text not null);
  alter table public.exercise_library enable row level security;
  create policy lib_read on public.exercise_library for select to authenticated using (true);
  grant select on public.exercise_library to authenticated;
  insert into public.profiles values ('${RON}'), ('${OTHER}');
  insert into public.exercise_library (id, created_by, name) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '${RON}', 'Viking Press'),
    ('aaaaaaaa-0000-0000-0000-000000000002', '${RON}', 'Z Press'),
    ('bbbbbbbb-0000-0000-0000-000000000001', '${OTHER}', 'Their Press');
`);

await db.exec(migration);
await db.exec(migration); // re-running is safe

async function as(user, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}
async function fails(user, sql) {
  await assert.rejects(() => as(user, sql));
}

// Ron makes a machine and puts his two exercises on it
await as(RON, `insert into public.gym_machines (id, created_by, name) values ('cccccccc-0000-0000-0000-000000000001', '${RON}', 'Viking press machine')`);
await as(RON, `insert into public.gym_machine_exercises (machine_id, exercise_id, position) values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 0), ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 1)`);
assert.equal((await as(RON, "select * from public.gym_machine_exercises")).rows.length, 2);

// not someone else's exercise on his machine, and not a machine in someone else's name
await fails(RON, `insert into public.gym_machine_exercises (machine_id, exercise_id) values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')`);
await fails(RON, `insert into public.gym_machines (created_by, name) values ('${OTHER}', 'Not mine')`);
// the name is 1 to 80 characters
await fails(RON, `insert into public.gym_machines (created_by, name) values ('${RON}', '')`);
await fails(RON, `insert into public.gym_machines (created_by, name) values ('${RON}', repeat('x', 81))`);

// another coach sees nothing of Ron's and changes nothing
assert.equal((await as(OTHER, "select * from public.gym_machines")).rows.length, 0);
assert.equal((await as(OTHER, "select * from public.gym_machine_exercises")).rows.length, 0);
await as(OTHER, "update public.gym_machines set name = 'Taken' where true");
await as(OTHER, "delete from public.gym_machine_exercises where true");
assert.equal((await as(RON, "select name from public.gym_machines")).rows[0].name, "Viking press machine");
assert.equal((await as(RON, "select * from public.gym_machine_exercises")).rows.length, 2);
// nor can they hang their exercise on Ron's machine
await fails(OTHER, `insert into public.gym_machine_exercises (machine_id, exercise_id) values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')`);

// a signed-out visitor reads nothing (the public page uses the server's key)
await fails(null, "select * from public.gym_machines");
await fails(null, "select * from public.gym_machine_exercises");

// Ron renames, removes one exercise, then deletes the machine: its exercise rows go with it, the library keeps the exercises
await as(RON, "update public.gym_machines set name = 'Viking press' where id = 'cccccccc-0000-0000-0000-000000000001'");
await as(RON, "delete from public.gym_machine_exercises where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000002'");
assert.equal((await as(RON, "select * from public.gym_machine_exercises")).rows.length, 1);
await as(RON, "delete from public.gym_machines where id = 'cccccccc-0000-0000-0000-000000000001'");
await db.exec("reset role");
assert.equal((await db.query("select count(*)::int as n from public.gym_machine_exercises")).rows[0].n, 0);
assert.equal((await db.query("select count(*)::int as n from public.exercise_library")).rows[0].n, 3);

console.log("gym machines: ok");
