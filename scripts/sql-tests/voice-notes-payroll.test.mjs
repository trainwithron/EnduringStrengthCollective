// Step 220 (migration 0464) in an in-memory Postgres set up like the live tables it touches: the paste runs (and runs again) and its check row is all true; a voice note's file
// goes only into the sender's own folder in a space they are in (never for a minor without a parent's OK), the message can only name the sender's own file, once, and nobody
// changes it afterwards; only the two people in the conversation can open the sound (not another client, not another coach, not the organization's owner, not someone signed
// out); a saved payroll report is read by the organization's owner and admins only, written by the server only, and never changed; the undo takes it all away.
// Run: node scripts/sql-tests/voice-notes-payroll.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8").split("\r\n").join("\n");
const paste = file("apply/apply-step220-0464.sql");
const undo = file("apply/undo-step220-0464.sql");
const migration = file("migrations/0464_voice_notes_payroll_reports.sql");
const COACH = "22222222-2222-4222-8222-222222222222";
const OTHER_COACH = "33333333-3333-4333-8333-333333333333";
const ANN = "44444444-4444-4444-8444-444444444444";
const BO = "55555555-5555-4555-8555-555555555555";
const OWNER = "66666666-6666-4666-8666-666666666666";
const ADMIN = "77777777-7777-4777-8777-777777777777";
const MINA = "88888888-8888-4888-8888-888888888888";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG2 = "aaaaaaaa-0000-4000-8000-000000000002";
const G1 = "bbbbbbbb-0000-4000-8000-000000000001";
const G2 = "bbbbbbbb-0000-4000-8000-000000000002";
const F1 = "cccccccc-0000-4000-8000-000000000001";
const F2 = "cccccccc-0000-4000-8000-000000000002";

assert.ok(paste.includes(migration.trim()), "the paste holds the migration byte for byte");
assert.equal(/[^\x00-\x7f]/.test(paste + undo), false, "the paste and the undo are ASCII");

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key);
  insert into public.profiles values ('${COACH}'), ('${OTHER_COACH}'), ('${ANN}'), ('${BO}'), ('${OWNER}'), ('${ADMIN}'), ('${MINA}'), ('${OUTSIDER}');
  create table public.organizations (id uuid primary key);
  insert into public.organizations values ('${ORG}'), ('${ORG2}');
  create table public.organization_memberships (organization_id uuid not null, profile_id uuid not null, role text not null);
  insert into public.organization_memberships values ('${ORG}', '${OWNER}', 'owner'), ('${ORG}', '${ADMIN}', 'admin'), ('${ORG}', '${COACH}', 'coach'), ('${ORG2}', '${OUTSIDER}', 'owner');
  create table public.groups (id uuid primary key, organization_id uuid);
  insert into public.groups values ('${G1}', '${ORG}'), ('${G2}', '${ORG}');
  create table public.group_memberships (group_id uuid not null, profile_id uuid not null, role text not null);
  insert into public.group_memberships values ('${G1}', '${COACH}', 'coach'), ('${G1}', '${ANN}', 'athlete'), ('${G1}', '${BO}', 'athlete'), ('${G1}', '${MINA}', 'athlete'), ('${G2}', '${OTHER_COACH}', 'coach');
  grant select on public.group_memberships to authenticated;
  create function public.is_group_member(_group_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = auth.uid()) $$;
  create function public.is_group_coach(_group_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = auth.uid() and role = 'coach') $$;
  create function public.is_org_admin_of_group(_group_id uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.groups g join public.organization_memberships om on om.organization_id = g.organization_id where g.id = _group_id and om.profile_id = auth.uid() and om.role in ('owner', 'admin')) $$;
  create function public.is_org_owner_or_admin(target_org_id uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.organization_memberships om where om.organization_id = target_org_id and om.profile_id = (select auth.uid()) and om.role in ('owner', 'admin')) $$;
  -- a minor with no parent's OK on file may not write (the live rule reads the dates and consents; here one list stands for it)
  create table public.minors_without_ok (profile_id uuid primary key);
  insert into public.minors_without_ok values ('${MINA}');
  create function public.minor_may_write(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$ select not exists (select 1 from public.minors_without_ok where profile_id = p_user) $$;
  grant execute on all functions in schema public to authenticated;

  -- direct_messages as 0140 made it, with 0345's organization owner read and 0417's minor guard
  create table public.direct_messages (
    id uuid primary key default gen_random_uuid(), group_id uuid not null, sender_id uuid not null references public.profiles(id) on delete cascade,
    recipient_id uuid not null references public.profiles(id) on delete cascade, body text not null, created_at timestamptz not null default now(), read_at timestamptz,
    check (sender_id <> recipient_id));
  alter table public.direct_messages enable row level security;
  grant select, insert, update on public.direct_messages to authenticated;
  create policy dm_select_participant on public.direct_messages for select to authenticated using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
  create policy direct_messages_select_org_owner on public.direct_messages for select to authenticated using (public.is_org_admin_of_group(group_id));
  create policy dm_insert_coach_athlete_pair on public.direct_messages for insert to authenticated with check (
    sender_id = (select auth.uid()) and public.is_group_member(group_id) and (
      (public.is_group_coach(group_id) and exists (select 1 from public.group_memberships gm where gm.group_id = direct_messages.group_id and gm.profile_id = recipient_id and gm.role = 'athlete'))
      or (not public.is_group_coach(group_id) and exists (select 1 from public.group_memberships gm where gm.group_id = direct_messages.group_id and gm.profile_id = recipient_id and gm.role = 'coach'))));
  create policy dm_update_mark_read on public.direct_messages for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
  create policy minor_write_guard_insert on public.direct_messages as restrictive for insert to authenticated with check (public.minor_may_write((select auth.uid())));

  create table public.payment_events (id uuid primary key default gen_random_uuid(), stripe_event_id text not null unique, kind text not null);

  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant execute on function storage.foldername(text) to anon, authenticated;
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to anon, authenticated;
`);

const as = async (who, fn, role = "authenticated") => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${who ?? ""}', false); select set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
  }
};
const fails = async (sql) => {
  try {
    await db.exec(sql);
  } catch (e) {
    if (process.env.DEBUG_SQL) console.log("refused:", e.message);
    return true;
  }
  return false;
};
const n = async (sql) => (await db.query(sql)).rows[0].n;
const changed = async (sql) => (await db.query(sql)).affectedRows ?? 0;

// the paste runs, twice, and its check row is all true
const at = paste.indexOf("-- check: one row");
assert.ok(at > 0, "the paste has its check");
await db.exec(paste.slice(0, at));
await db.exec(paste.slice(0, at));
const check = (await db.query(paste.slice(at))).rows[0];
assert.ok(Object.keys(check).length >= 9, "the check row has its columns");
for (const [k, v] of Object.entries(check)) assert.equal(v, true, `check row: ${k}`);

// ---- voice notes ----
const annFile = `${ANN}/${G1}/${F1}.webm`;
const coachFile = `${COACH}/${G1}/${F2}.m4a`;
const put = (name) => `insert into storage.objects (bucket_id, name) values ('voice-notes', '${name}')`;
const note = (sender, recipient, path, seconds = 30, group = G1) =>
  `insert into public.direct_messages (group_id, sender_id, recipient_id, body, voice_path, voice_seconds) values ('${group}', '${sender}', '${recipient}', 'Voice note', '${path}', ${seconds})`;

await as(ANN, async () => {
  assert.equal(await fails(put(`${COACH}/${G1}/${F1}.webm`)), true, "a file into someone else's folder");
  assert.equal(await fails(put(`${ANN}/${G2}/${F1}.webm`)), true, "a file for a space the sender is not in");
  assert.equal(await fails(put(`${ANN}/not-a-space/${F1}.webm`)), true, "a file with no space");
  assert.equal(await fails(put(annFile)), false, "the client's own file");
  assert.equal(await fails(note(ANN, COACH, coachFile)), true, "a message naming someone else's file");
  assert.equal(await fails(note(ANN, COACH, annFile, 121)), true, "longer than two minutes");
  assert.equal(await fails(note(ANN, COACH, annFile, 0)), true, "no length");
  assert.equal(await fails(`insert into public.direct_messages (group_id, sender_id, recipient_id, body, voice_path) values ('${G1}', '${ANN}', '${COACH}', 'Voice note', '${annFile}')`), true, "a file with no length");
  assert.equal(await fails(`insert into public.direct_messages (group_id, sender_id, recipient_id, body, voice_path, voice_seconds) values ('${G1}', '${ANN}', '${COACH}', 'Voice note', '${ANN}/${G1}/x.exe', 5)`), true, "a file that is not a recording");
  assert.equal(await fails(note(ANN, BO, annFile)), true, "a voice note to another client");
  assert.equal(await fails(note(ANN, COACH, annFile)), false, "the client's voice note to their coach");
  assert.equal(await fails(note(ANN, COACH, annFile)), true, "the same file sent twice");
  assert.equal(await n(`select count(*)::int n from storage.objects where name = '${annFile}'`), 1, "the sender hears their own");
  assert.equal(await fails(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ('${G1}', '${ANN}', '${COACH}', 'Plain words')`), false, "a plain message is as before");
});
// a minor without a parent's OK records nothing
await as(MINA, async () => assert.equal(await fails(put(`${MINA}/${G1}/${F2}.webm`)), true, "a minor without a parent's OK uploads"));

// only the two people in the conversation open it
await as(COACH, async () => {
  assert.equal(await n(`select count(*)::int n from storage.objects where name = '${annFile}'`), 1, "the coach it was sent to hears it");
  // the coach marks it read, and cannot change the recording
  assert.equal(await changed(`update public.direct_messages set read_at = now(), voice_path = '${COACH}/${G1}/${F2}.m4a', voice_seconds = 99 where voice_path = '${annFile}'`), 1, "the coach marks it read");
  assert.equal(await fails(put(coachFile)), false, "the coach's own file");
  assert.equal(await fails(note(COACH, ANN, coachFile, 12)), false, "the coach's voice note to the client");
  assert.equal(await changed(`delete from storage.objects where name = '${annFile}'`), 0, "the coach removes the client's file");
});
assert.deepEqual((await db.query(`select voice_path, voice_seconds, read_at is not null as read from public.direct_messages where voice_path = '${annFile}'`)).rows[0], { voice_path: annFile, voice_seconds: 30, read: true }, "the recording is as sent");
for (const [who, label] of [[BO, "another client"], [OTHER_COACH, "a coach of another space"], [OWNER, "the organization's owner"], [OUTSIDER, "someone else"]]) {
  await as(who, async () => {
    assert.equal(await n(`select count(*)::int n from storage.objects where bucket_id = 'voice-notes'`), 0, `${label} hears nothing`);
    assert.equal(await changed(`delete from storage.objects where bucket_id = 'voice-notes'`), 0, `${label} removes nothing`);
  });
}
// the owner still sees the message line as before (0345), just not the sound
await as(OWNER, async () => assert.equal(await n(`select count(*)::int n from public.direct_messages where voice_path = '${annFile}'`), 1, "the owner sees the line"));
await as(null, async () => assert.equal(await n(`select count(*)::int n from storage.objects where bucket_id = 'voice-notes'`), 0, "signed out hears nothing"), "anon");
await as(ANN, async () => {
  assert.equal(await n(`select count(*)::int n from storage.objects where name = '${coachFile}'`), 1, "the client hears the coach's voice note to them");
  assert.equal(await changed(`delete from storage.objects where name = '${annFile}'`), 1, "the sender removes their own file");
});

// ---- the next try on a failed card ----
await db.exec(`insert into public.payment_events (stripe_event_id, kind, next_attempt_at) values ('evt_1', 'payment_failed', now() + interval '3 days')`);

// ---- saved payroll reports ----
const report = `insert into public.payroll_reports (organization_id, created_by, from_day, to_day, time_zone, note, snapshot) values ('${ORG}', '${OWNER}', '2026-11-01', '2026-11-15', 'America/New_York', 'First half', '{"rows": [{"name": "Coach", "sessionsDelivered": 4, "rateCents": 4500, "estimateCents": 18000}]}')`;
for (const [who, label] of [[OWNER, "the owner"], [ADMIN, "an admin"], [COACH, "a coach"], [OUTSIDER, "someone else"]]) {
  await as(who, async () => assert.equal(await fails(report), true, `${label} writes a report directly`));
}
await db.exec(report);
assert.equal(await fails(`insert into public.payroll_reports (organization_id, from_day, to_day, time_zone, snapshot) values ('${ORG}', '2026-11-15', '2026-11-01', 'UTC', '{}')`), true, "a period that ends before it starts");
await as(OWNER, async () => assert.equal(await n(`select count(*)::int n from public.payroll_reports`), 1, "the owner reads it"));
await as(ADMIN, async () => {
  assert.equal(await n(`select count(*)::int n from public.payroll_reports`), 1, "an admin reads it");
  assert.equal(await fails(`update public.payroll_reports set note = 'changed'`), true, "an admin changes it");
  assert.equal(await fails(`delete from public.payroll_reports`), true, "an admin deletes it");
});
await as(COACH, async () => assert.equal(await n(`select count(*)::int n from public.payroll_reports`), 0, "a coach who is not an owner or admin"));
await as(OUTSIDER, async () => assert.equal(await n(`select count(*)::int n from public.payroll_reports`), 0, "the owner of another organization"));
await as(null, async () => assert.equal(await fails(`select * from public.payroll_reports`), true, "signed out"), "anon");
assert.equal(await fails(`update public.payroll_reports set snapshot = '{}'`), true, "the server changes a saved report");
assert.equal((await db.query(`select snapshot->'rows'->0->>'estimateCents' as e from public.payroll_reports`)).rows[0].e, "18000", "the report is as saved");

// ---- the undo ----
await db.exec(undo);
const gone = (await db.query(`select
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'direct_messages' and column_name in ('voice_path', 'voice_seconds')) as voice_cols,
  to_regclass('public.payroll_reports') is null as payroll_gone,
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'payment_events' and column_name = 'next_attempt_at') as next_col,
  (select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'voice_notes%') as voice_rules,
  (select count(*)::int from public.direct_messages) as messages_kept`)).rows[0];
assert.deepEqual(gone, { voice_cols: 0, payroll_gone: true, next_col: 0, voice_rules: 0, messages_kept: 3 }, "the undo takes it away and keeps the messages");

console.log("voice notes and payroll reports rehearsal: all checks passed");
