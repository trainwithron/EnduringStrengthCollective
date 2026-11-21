// Rehearses step 218 (migration 0462, wave 3 calendar and requests) on an in-memory Postgres with small stand-ins, the migration run twice (re-running is safe).
//   node scripts/sql-tests/wave3-calendar.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const lf = (s) => s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const read = (p) => lf(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, full_name text, timezone text, quiet_hours_start smallint, quiet_hours_end smallint, created_at timestamptz default now());
  create table public.group_memberships (id serial primary key, group_id uuid, profile_id uuid, role text, joined_at timestamptz default now());
  create table public.organization_memberships (id serial primary key, organization_id uuid, profile_id uuid, role text);
  create table public.booking_requests (id uuid primary key default gen_random_uuid(), status text);
  create function public.coach_time_zone(p_coach_id uuid) returns text language sql stable as $$ select timezone from public.profiles where id = p_coach_id $$;
`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const coach = id(1), existing = id(2), group = id(100), otherGroup = id(101);
await db.query(`insert into public.profiles (id, full_name, timezone) values ($1, 'Coach Ron', 'America/Chicago'), ($2, 'Old Client', null)`, [coach, existing]);
await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach'), ($3, $2, 'coach')`, [group, coach, otherGroup]);

const migration = read("../../supabase/migrations/0462_wave3_calendar.sql");
await db.exec(migration);
await db.exec(migration);

const failures = [];
const expect = (name, cond) => { if (!cond) failures.push(name); };
const prof = async (p) => (await db.query(`select * from public.profiles where id = $1`, [p])).rows[0];
const join = (g, p, role = "athlete") => db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, $3)`, [g, p, role]);

// C1
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'booking_requests'`)).rows.map((r) => r.column_name);
expect("C1: lapse_warned_at and lapse_told_at exist", cols.includes("lapse_warned_at") && cols.includes("lapse_told_at"));

// R8
await join(group, existing);
let p = await prof(existing);
expect("R8: an account made before this step is never changed", p.quiet_hours_start === null && p.quiet_hours_end === null && p.timezone === null && p.quiet_hours_default_pending === false);

const fresh = id(3);
await db.query(`insert into public.profiles (id, full_name) values ($1, 'New Client')`, [fresh]);
await join(group, fresh);
p = await prof(fresh);
expect("R8: a new client gets 9 PM to 7 AM, in their coach's time zone when theirs is not known", p.quiet_hours_start === 21 && p.quiet_hours_end === 7 && p.timezone === "America/Chicago" && p.quiet_hours_default_pending === false);

const ownZone = id(4);
await db.query(`insert into public.profiles (id, full_name, timezone) values ($1, 'Zoned Client', 'Europe/London')`, [ownZone]);
await join(group, ownZone);
p = await prof(ownZone);
expect("R8: a new client with their own time zone keeps it", p.quiet_hours_start === 21 && p.quiet_hours_end === 7 && p.timezone === "Europe/London");

const ownHours = id(5);
await db.query(`insert into public.profiles (id, full_name, quiet_hours_start, quiet_hours_end) values ($1, 'Night Owl', 1, 5)`, [ownHours]);
await join(group, ownHours);
p = await prof(ownHours);
expect("R8: a new client who already set their own quiet hours keeps them", p.quiet_hours_start === 1 && p.quiet_hours_end === 5);

const newCoach = id(6);
await db.query(`insert into public.profiles (id, full_name) values ($1, 'New Coach')`, [newCoach]);
await join(otherGroup, newCoach, "coach");
expect("R8: joining as a coach changes nothing", (await prof(newCoach)).quiet_hours_start === null);
await join(group, newCoach);
p = await prof(newCoach);
expect("R8: a coach who is also someone's client is never given quiet hours", p.quiet_hours_start === null && p.quiet_hours_end === null && p.quiet_hours_default_pending === false);

const seated = id(7);
await db.query(`insert into public.profiles (id, full_name) values ($1, 'Gym Staff')`, [seated]);
await db.query(`insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'coach')`, [id(200), seated]);
await join(group, seated);
expect("R8: anyone with an organization seat is left alone", (await prof(seated)).quiet_hours_start === null);

// once only: a client who turned quiet hours off is not given them again by joining another group
await db.query(`update public.profiles set quiet_hours_start = null, quiet_hours_end = null where id = $1`, [fresh]);
await join(otherGroup, fresh);
p = await prof(fresh);
expect("R8: at most once: turned off stays off", p.quiet_hours_start === null && p.quiet_hours_end === null);

const priv = (await db.query(`select has_function_privilege('authenticated', 'public.default_new_client_quiet_hours()', 'execute') as a`)).rows[0];
expect("R8: nobody calls the trigger function directly", priv.a === false);

// C8
const as = async (who, sql, params = []) => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [who ?? ""]);
    await db.exec("set local role authenticated");
    const r = await db.query(sql, params);
    await db.exec("commit");
    return { rows: r.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e };
  }
};
const first = await as(coach, "select public.new_calendar_feed_link() as t");
const t1 = first.rows[0]?.t;
expect("C8: a coach gets a 64-character secret", !first.error && /^[0-9a-f]{64}$/.test(t1 ?? ""));
const second = await as(coach, "select public.new_calendar_feed_link() as t");
const t2 = second.rows[0]?.t;
const coachRows = (await db.query("select token from public.coach_calendar_feeds where coach_id = $1", [coach])).rows;
expect("C8: a new link replaces the old one, one per coach", t2 && t2 !== t1 && coachRows.length === 1 && coachRows[0].token === t2);
expect("C8: someone who coaches no group is refused", (await as(fresh, "select public.new_calendar_feed_link()")).error !== null);
expect("C8: signed out is refused", (await as(null, "select public.new_calendar_feed_link()")).error !== null);
await as(newCoach, "select public.new_calendar_feed_link()");
expect("C8: a coach sees only their own link", (await as(coach, "select coach_id from public.coach_calendar_feeds")).rows.every((r) => r.coach_id === coach));
expect("C8: a client sees no links at all", (await as(fresh, "select * from public.coach_calendar_feeds")).rows.length === 0);
expect("C8: nobody writes the table directly", (await as(coach, "update public.coach_calendar_feeds set token = repeat('a', 64)")).error !== null);
expect("C8: signed-out callers cannot run the functions", (await db.query("select has_function_privilege('anon', 'public.new_calendar_feed_link()', 'execute') as a, has_function_privilege('anon', 'public.turn_off_calendar_feed()', 'execute') as b")).rows.every((r) => r.a === false && r.b === false));
await as(coach, "select public.turn_off_calendar_feed()");
const left = (await db.query("select coach_id from public.coach_calendar_feeds")).rows.map((r) => r.coach_id);
expect("C8: Turn off removes only the caller's own link", !left.includes(coach) && left.includes(newCoach));

if (failures.length) {
  console.error("FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("OK: step 218 rehearsal passed");
