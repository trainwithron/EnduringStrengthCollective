// Migration 0461 / paste step 217 (a team sheet read from a photo is saved as source "photo") in an in-memory Postgres, against the LIVE team_sheet_save (fixtures/team-sheet-save-live-nov20.sql:
// 0419 with 0436's one change, body md5 dbd5ec55e9d3a4755e9904df4be72e24, the same as live on Nov 20): the paste runs (and runs again) to a check row of all true; "photo" gets past the
// function's source check and into team_sheet_batches, an unknown source is still refused; nothing else in the function changes; the undo puts the body back to the live md5 exactly,
// keeps a "photo" upload already saved (the check comes back NOT VALID), and the paste applies again. Run: node scripts/sql-tests/team-sheet-photo.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const lf = (s) => s.split("\r\n").join("\n");
const file = (p) => lf(readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8"));
const paste = file("apply/apply-step217-0461.sql");
const undo = file("apply/undo-step217-0461.sql");
assert.ok(paste.includes(file("migrations/0461_team_sheet_photo_source.sql").trimEnd()), "the paste carries the migration as written");
const LIVE_MD5 = "dbd5ec55e9d3a4755e9904df4be72e24";
const COACH = "11111111-1111-1111-1111-111111111111";
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (id uuid primary key);
  create table public.groups (id uuid primary key);
  insert into public.profiles values ('${COACH}');
  insert into public.groups values ('${GROUP}');
  create function public.is_group_coach(_group_id uuid) returns boolean language sql stable as $$ select auth.uid() is not null $$;
  create function public.group_in_active_org(_group_id uuid) returns boolean language sql stable as $$ select true $$;
  -- team_sheet_batches as live (the columns and the source check)
  create table public.team_sheet_batches (
    id uuid primary key, group_id uuid not null references public.groups(id) on delete cascade, created_by uuid references public.profiles(id) on delete set null,
    source text not null, created_at timestamptz not null default now(), sessions_saved integer not null default 0, athletes_count integer not null default 0,
    records_count integer not null default 0, kept_count integer not null default 0, replaced_count integer not null default 0, first_day date, last_day date, undone_at timestamptz,
    constraint team_sheet_batches_source_check check (source = any (array['xlsx'::text, 'csv'::text]))
  );
`);
await db.exec(lf(readFileSync(new URL("./fixtures/team-sheet-save-live-nov20.sql", import.meta.url), "utf8")));
const bodyMd5 = async () => (await db.query(`select md5(replace(prosrc, E'\\r\\n', E'\\n')) m from pg_proc where proname = 'team_sheet_save'`)).rows[0].m;
assert.equal(await bodyMd5(), LIVE_MD5, "the fixture is the live function");

// as the coach: an empty save with no batch stops at the rows check only once the source check has passed
async function sourceError(source) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${COACH}', false)`);
  try {
    await db.query(`select public.team_sheet_save('${GROUP}', '${source}', '[]'::jsonb, false, null, true)`);
    return "no error";
  } catch (e) {
    return String(e.message);
  }
}
assert.match(await sourceError("photo"), /unknown source/, "before the paste a photo is refused (the save route says it is not switched on yet)");

const checkRow = async () => {
  const res = await db.query(paste.slice(paste.indexOf("-- Check: one row, all true.")));
  assert.equal(res.rows.length, 1);
  return res.rows[0];
};
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true), JSON.stringify(await checkRow()));
assert.equal(Object.keys(await checkRow()).length, 3);
await db.exec(paste); // re-running is safe
assert.ok(Object.values(await checkRow()).every((v) => v === true));

// "photo" passes the source check now; an unknown source is still refused
assert.match(await sourceError("photo"), /between 1 and 400 rows are needed/);
assert.match(await sourceError("xlsx"), /between 1 and 400 rows are needed/);
assert.match(await sourceError("zip"), /unknown source/);
// the table takes it
await db.exec(`insert into public.team_sheet_batches (id, group_id, created_by, source) values (gen_random_uuid(), '${GROUP}', '${COACH}', 'photo')`);
await assert.rejects(() => db.exec(`insert into public.team_sheet_batches (id, group_id, created_by, source) values (gen_random_uuid(), '${GROUP}', '${COACH}', 'zip')`));

// only the source check changed: the patched body is the live body with that one line
const patched = (await db.query(`select replace(prosrc, E'\\r\\n', E'\\n') p from pg_proc where proname = 'team_sheet_save'`)).rows[0].p;
const backToLive = patched.replace("p_source not in ('xlsx', 'csv', 'photo')", "p_source not in ('xlsx', 'csv')");
assert.equal((await db.query(`select md5($1) m`, [backToLive])).rows[0].m, LIVE_MD5);

// the undo: the body is exactly live again, the "photo" upload already saved stays (the check comes back NOT VALID), and a new photo save is refused again
await db.exec(undo);
assert.equal(await bodyMd5(), LIVE_MD5, "the undo restores the live body exactly");
assert.equal((await db.query(`select count(*)::int n from public.team_sheet_batches where source = 'photo'`)).rows[0].n, 1);
assert.equal((await db.query(`select convalidated v from pg_constraint where conname = 'team_sheet_batches_source_check'`)).rows[0].v, false);
assert.match(await sourceError("photo"), /unknown source/);
await assert.rejects(() => db.exec(`insert into public.team_sheet_batches (id, group_id, created_by, source) values (gen_random_uuid(), '${GROUP}', '${COACH}', 'photo')`));

// and the paste applies again cleanly
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true));

console.log("team sheet photo source: ok");
