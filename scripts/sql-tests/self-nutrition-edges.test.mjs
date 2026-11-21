// Rehearses step 221 (migration 0465): a coach on their OWN personal-space nutrition. On an in-memory Postgres with small stand-ins and the LIVE apply_meal_plan_try and
// apply_allergy_rebuild of Nov 21 (fixtures/meal-plan-self-live-nov21.sql), the migration run twice (re-running is safe).
//   node scripts/sql-tests/self-nutrition-edges.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const lf = (s) => s.split(CRLF).join(LF);
const read = (p) => lf(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = new PGlite();
const failures = [];
const expect = (name, cond) => {
  if (!cond) failures.push(name);
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, full_name text);
  create table public.groups (id uuid primary key, created_by uuid, organization_id uuid);
  create table public.group_memberships (group_id uuid, profile_id uuid, role text);
  create function public.is_group_coach(g uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.group_memberships where group_id = g and profile_id = auth.uid() and role = 'coach') $$;
  create table public.client_nutrition_flags (group_id uuid not null, profile_id uuid not null, auto_off boolean not null default false, set_by uuid, updated_at timestamptz not null default now(), primary key (group_id, profile_id));
  alter table public.client_nutrition_flags enable row level security;
  create policy "client_nutrition_flags_coach_all" on public.client_nutrition_flags for all using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id) and (auto_off = false or exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_flags.group_id and gm.profile_id = client_nutrition_flags.profile_id and gm.role = 'athlete')));
  create table public.meal_plans (id uuid primary key default gen_random_uuid(), athlete_id uuid, group_id uuid, log_date date, archetype text, meal_count int, include_snack boolean, carb_cycling boolean, rationale text, macros jsonb, meals jsonb, created_by uuid, unique (athlete_id, log_date));
  create table public.meal_plan_tries (id uuid primary key default gen_random_uuid(), athlete_id uuid not null, group_id uuid not null, try_number smallint not null, note text not null default '', summary text not null default '', dates date[] not null, previous_plan jsonb not null default '[]', source text not null default 'client');
  create table public.notifications (profile_id uuid, group_id uuid, type text, body text, link_path text);
  create function public.meal_plan_try_number(p_rationale text) returns integer language sql immutable as $$ select (substring(p_rationale from '^Rebuilt at the client''s request [(]try ([1-3]) of 3[)][.]$'))::int $$;
`);

// The live functions, their lines ending in CR LF as they do live.
const fixture = read("./fixtures/meal-plan-self-live-nov21.sql");
const parts = fixture.split("$function$");
let rebuilt = parts[0];
for (let i = 1; i < parts.length; i++) rebuilt += "$function$" + (i % 2 === 1 ? parts[i].split(LF).join(CRLF) : parts[i]);
await db.exec(rebuilt);
const md5s = async () => Object.fromEntries((await db.query(`select proname, md5(prosrc) m, md5(replace(prosrc, chr(13), '')) l from pg_proc where proname in ('apply_meal_plan_try', 'apply_allergy_rebuild')`)).rows.map((r) => [r.proname, r]));
const live = await md5s();
expect("fixture: apply_allergy_rebuild is the live one", live.apply_allergy_rebuild?.m === "5f50784e10a6286842f4a088a1cdd7d2");
expect("fixture: apply_meal_plan_try is the live one", live.apply_meal_plan_try?.m === "c6a9e52c6fc991153682bd1ed5be003f");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const coach = id(1), other = id(2), client = id(3), space = id(10), orgGroup = id(11), otherSpace = id(12), org = id(99);
await db.query(`insert into public.profiles values ($1, 'Ron Arnold'), ($2, 'Other Coach'), ($3, 'Hewan Belete')`, [coach, other, client]);
await db.query(`insert into public.groups values ($1, $2, null), ($3, $2, $4), ($5, $6, null)`, [space, coach, orgGroup, org, otherSpace, other]);
await db.query(`insert into public.group_memberships values ($1, $2, 'coach'), ($3, $2, 'coach'), ($3, $4, 'athlete'), ($5, $6, 'coach')`, [space, coach, orgGroup, client, otherSpace, other]);

const migration = read("../../supabase/migrations/0465_self_nutrition_edges.sql");
await db.exec(migration);
await db.exec(migration);
const after = await md5s();
expect("both functions are patched", after.apply_allergy_rebuild.l !== live.apply_allergy_rebuild.l && after.apply_meal_plan_try.l !== live.apply_meal_plan_try.l);

// As a signed-in person.
const as = async (who, sql, params = []) => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [who]);
    await db.exec("set local role authenticated");
    const r = await db.query(sql, params);
    await db.exec("commit");
    return { rows: r.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e };
  }
};
const setFlag = (who, group, profile) => as(who, `insert into public.client_nutrition_flags (group_id, profile_id, auto_off) values ($1, $2, true) on conflict (group_id, profile_id) do update set auto_off = true`, [group, profile]);

// (a) auto-flags off
expect("(a) a coach turns their OWN auto-flags off in their own personal space", (await setFlag(coach, space, coach)).error === null);
expect("(a) a client's auto-flags still go off as before", (await setFlag(coach, orgGroup, client)).error === null);
expect("(a) a coach cannot turn them off for themselves in an organization's group (not their space)", (await setFlag(coach, orgGroup, coach)).error !== null);
expect("(a) nor for someone who is not an athlete there, even in their own space", (await setFlag(coach, space, other)).error !== null);
expect("(a) another coach cannot touch someone else's space", (await setFlag(other, space, coach)).error !== null);
expect("(a) turning them back ON is allowed as before", (await as(coach, `update public.client_nutrition_flags set auto_off = false where group_id = $1 and profile_id = $2`, [space, coach])).error === null);

// (c) a different plan and the allergy rebuild (called by the server, which has checked who is asking)
const today = "2026-11-21";
const seedPlan = async (athlete, group, author) => {
  await db.query(`delete from public.meal_plans where athlete_id = $1`, [athlete]);
  await db.query(`insert into public.meal_plans (athlete_id, group_id, log_date, rationale, meals, created_by) values ($1, $2, $3, 'Built from the recipe library for the week.', '{}', $4)`, [athlete, group, today, author]);
};
const rows = (author) => JSON.stringify([{ log_date: today, archetype: "a", meal_count: 3, include_snack: false, carb_cycling: false, macros: {}, meals: {}, created_by: author }]);
const tryFor = async (athlete, group, author) => {
  try {
    await db.query(`select public.apply_meal_plan_try($1, $2, $3, $4::jsonb, 'more fish', 'more fish')`, [athlete, group, today, rows(author)]);
    return null;
  } catch (e) {
    return String(e.message);
  }
};
const rebuildFor = async (athlete, group) => {
  try {
    await db.query(`select public.apply_allergy_rebuild($1, $2, $3, $4::jsonb, 'Your plan changed for a new allergy.')`, [athlete, group, today, JSON.stringify([{ log_date: today, meals: { a: 1 } }])]);
    return null;
  } catch (e) {
    return String(e.message);
  }
};

await seedPlan(coach, space, coach);
await db.query("delete from public.notifications");
expect("(c) a coach asks for a different plan in their own personal space", (await tryFor(coach, space, coach)) === null);
expect("(c) and is not told about their own request", (await db.query(`select count(*)::int n from public.notifications`)).rows[0].n === 0);
expect("(c) the allergy rebuild works on their own plan too", (await rebuildFor(coach, space)) === null);
expect("(c) still nobody told about their own plan", (await db.query(`select count(*)::int n from public.notifications`)).rows[0].n === 0);

await seedPlan(client, orgGroup, coach);
await db.query("delete from public.notifications");
expect("(c) a client asks as before", (await tryFor(client, orgGroup, coach)) === null);
expect("(c) and their coach is told as before", (await db.query(`select count(*)::int n from public.notifications where profile_id = $1`, [coach])).rows[0].n === 1);

expect("(c) a coach is still refused as the athlete of an organization's group", /not_a_client/.test((await tryFor(coach, orgGroup, coach)) ?? ""));
expect("(c) another coach is still refused in someone else's personal space", /not_a_client/.test((await tryFor(other, space, coach)) ?? ""));
expect("(c) the rebuild refuses another coach in someone else's space", /not_a_client/.test((await rebuildFor(other, space)) ?? ""));

// The paste and its undo.
const apply = read("../../supabase/apply/apply-step221-0465.sql");
const undo = read("../../supabase/apply/undo-step221-0465.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste: holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo: plain ASCII", ascii(apply) && ascii(undo));
const lastRow = (results) => results[results.length - 1].rows[0];
const allTrue = (row) => !!row && Object.values(row).every((v) => v === true);
expect("paste: check row all true", allTrue(lastRow(await db.exec(apply))));
expect("undo: check row all true", allTrue(lastRow(await db.exec(undo))));
const back = await md5s();
expect("undo: both functions back exactly as they were (line endings aside)", back.apply_meal_plan_try.l === live.apply_meal_plan_try.l && back.apply_allergy_rebuild.l === live.apply_allergy_rebuild.l);
expect("undo: a coach is refused on their own space again (the rule is back)", (await setFlag(coach, space, coach)).error !== null);
expect("paste: applies again after the undo", allTrue(lastRow(await db.exec(apply))));

if (failures.length) {
  console.error("FAILED:" + LF + "- " + failures.join(LF + "- "));
  process.exit(1);
}
console.log("OK: step 221 rehearsal passed");
