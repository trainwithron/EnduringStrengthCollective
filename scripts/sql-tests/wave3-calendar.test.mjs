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
  create table public.booking_requests (id uuid primary key default gen_random_uuid(), status text, decided_at timestamptz);
  create table public.org_connect_accounts (organization_id uuid primary key, stripe_account_id text, status text);
  create table public.organizations (id uuid primary key);
  create table public.groups (id uuid primary key);
  create table public.session_types (id uuid primary key default gen_random_uuid(), coach_id uuid, name text, display_price_cents int, organization_id uuid);
  create table public.bookings (id uuid primary key default gen_random_uuid(), status text, athlete_id uuid, group_id uuid, coach_id uuid, late_charge_state text, late_change_kind text, credit_state text);
  create table public.credit_log (athlete_id uuid, amount int, booking_id uuid);
  create function public.is_group_coach(g uuid) returns boolean language sql as $$ select true $$;
  create function public.is_org_admin_of_group(g uuid) returns boolean language sql as $$ select false $$;
  create function public.booking_late_move_charged(b uuid) returns boolean language sql as $$ select false $$;
  create function public.booking_taken(b uuid) returns int language sql as $$ select 0 $$;
  create function public.apply_session_credit_change(a uuid, g uuid, n int, k text, why text, b uuid, by uuid) returns void language sql as $$ insert into public.credit_log values (a, n, b) $$;
  create table public.booking_manage_links (id uuid primary key default gen_random_uuid(), booking_id uuid);
  create function public.coach_time_zone(p_coach_id uuid) returns text language sql stable as $$ select timezone from public.profiles where id = p_coach_id $$;
`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const coach = id(1), existing = id(2), group = id(100), otherGroup = id(101);
await db.query(`insert into public.profiles (id, full_name, timezone) values ($1, 'Coach Ron', 'America/Chicago'), ($2, 'Old Client', null)`, [coach, existing]);
await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach'), ($3, $2, 'coach')`, [group, coach, otherGroup]);

// The LIVE resolve_late_change of Nov 20, its lines ending in CR LF as they do live (md5 0010aa033f297f17b1feea309f052d4c).
const fixture = read("./fixtures/resolve-late-change-live-nov20.sql");
const [fxHead, fxBody, fxTail] = fixture.split("$function$");
await db.exec(fxHead + "$function$" + fxBody.split(String.fromCharCode(10)).join(String.fromCharCode(13, 10)) + "$function$" + fxTail);
const lateMd5 = async () => (await db.query(`select md5(prosrc) m, md5(replace(prosrc, chr(13), '')) lf from pg_proc where proname = 'resolve_late_change'`)).rows[0];
const liveMd5 = await lateMd5();
const failures = [];
const expect = (name, cond) => { if (!cond) failures.push(name); };
const migration = read("../../supabase/migrations/0462_wave3_calendar.sql");
// a request that lapsed before this step
const oldLapse = (await db.query(`insert into public.booking_requests (status, decided_at) values ('expired', now() - interval '3 hours') returning id`)).rows[0].id;
await db.exec(migration);
await db.exec(migration);
expect("C1: a request that lapsed before this step is never announced now", (await db.query(`select lapse_told_at from public.booking_requests where id = $1`, [oldLapse])).rows[0].lapse_told_at !== null);
const newLapse = (await db.query(`insert into public.booking_requests (status, decided_at) values ('expired', now()) returning id`)).rows[0].id;
await db.exec(migration);
expect("C1: one that lapses after it is (running the step again does not mark it)", (await db.query(`select lapse_told_at from public.booking_requests where id = $1`, [newLapse])).rows[0].lapse_told_at === null);

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

// C7
const org = id(300);
await db.query(`insert into public.organizations (id) values ($1)`, [org]);
const oldType = (await db.query(`select id from public.session_types limit 1`)).rows[0];
expect("C7: no stand-in type yet", !oldType);
const typeId = (await db.query(`insert into public.session_types (coach_id, name, display_price_cents) values ($1, 'Training', 6000) returning id, pay_to_book`, [coach])).rows[0];
expect("C7: Pay when booking starts off", typeId.pay_to_book === false);
// Pay when booking needs a price of at least a dollar and a ready Stripe account
const tryOn = async (sql, params) => { try { await db.query(sql, params); return true; } catch { return false; } };
await db.query(`update public.session_types set organization_id = $1 where id = $2`, [org, typeId.id]);
expect("C7: refused on while the organization's Stripe account is not ready", !(await tryOn(`update public.session_types set pay_to_book = true where id = $1`, [typeId.id])));
await db.query(`insert into public.org_connect_accounts (organization_id, stripe_account_id, status) values ($1, 'acct_1', 'pending')`, [org]);
expect("C7: refused on while it is still pending", !(await tryOn(`update public.session_types set pay_to_book = true where id = $1`, [typeId.id])));
await db.query(`update public.org_connect_accounts set status = 'ready' where organization_id = $1`, [org]);
expect("C7: on once the account is ready and there is a price", await tryOn(`update public.session_types set pay_to_book = true where id = $1`, [typeId.id]));
expect("C7: the price cannot drop under a dollar while it is on", !(await tryOn(`update public.session_types set display_price_cents = 50 where id = $1`, [typeId.id])));
expect("C7: no price, no switch (even when made that way)", !(await tryOn(`insert into public.session_types (coach_id, name, display_price_cents, organization_id, pay_to_book) values ($1, 'Free', null, $2, true)`, [coach, org])));
expect("C7: turning it off is always allowed, with the price at once", await tryOn(`update public.session_types set pay_to_book = false, display_price_cents = null where id = $1`, [typeId.id]));
await db.query(`update public.session_types set display_price_cents = 6000 where id = $1`, [typeId.id]);
// a coach leaving: their types move to their own new organization (no Stripe there) and Pay when booking goes off, never refusing the leave
await db.query(`update public.session_types set pay_to_book = true where id = $1`, [typeId.id]);
const soloOrg = id(301);
await db.query(`insert into public.organizations (id) values ($1)`, [soloOrg]);
expect("C7: moving a paid type to an organization without Stripe succeeds (a departure never fails over it)", await tryOn(`update public.session_types set organization_id = $1 where id = $2`, [soloOrg, typeId.id]));
expect("C7: and Pay when booking is off after the move", (await db.query(`select pay_to_book from public.session_types where id = $1`, [typeId.id])).rows[0].pay_to_book === false);
await db.query(`update public.session_types set organization_id = $1 where id = $2`, [org, typeId.id]);

// who cancelled a session: the signed-in person; nobody when the server does it; cleared if it comes back
const cb = (await db.query(`insert into public.bookings (status, athlete_id, coach_id) values ('confirmed', $1, $2) returning id`, [fresh, coach])).rows[0].id;
const byCoach = await as(coach, `update public.bookings set status = 'cancelled' where id = '${cb}'`);
expect("C7: a coach's cancel is recorded as theirs", !byCoach.error && (await db.query(`select cancelled_by from public.bookings where id = $1`, [cb])).rows[0].cancelled_by === coach);
await db.query(`update public.bookings set status = 'confirmed' where id = $1`, [cb]);
expect("C7: a session that comes back has no canceller", (await db.query(`select cancelled_by from public.bookings where id = $1`, [cb])).rows[0].cancelled_by === null);
await db.query(`update public.bookings set status = 'cancelled' where id = $1`, [cb]);
expect("C7: the server's cancel (a visitor's link, a job) has no canceller", (await db.query(`select cancelled_by from public.bookings where id = $1`, [cb])).rows[0].cancelled_by === null);
// it cannot be written directly: an update that sets it, or changes anything else, keeps what it was
await db.query(`update public.bookings set cancelled_by = $1 where id = $2`, [coach, cb]);
expect("C7: who cancelled cannot be written directly (cancelled)", (await db.query(`select cancelled_by from public.bookings where id = $1`, [cb])).rows[0].cancelled_by === null);
const cb2 = (await db.query(`insert into public.bookings (status, athlete_id, coach_id) values ('confirmed', $1, $2) returning id`, [fresh, coach])).rows[0].id;
await as(coach, `update public.bookings set status = 'cancelled' where id = '${cb2}'`);
await db.query(`update public.bookings set cancelled_by = $1, late_charge_state = 'waived' where id = $2`, [fresh, cb2]);
expect("C7: another change to a cancelled session keeps who cancelled it", (await db.query(`select cancelled_by from public.bookings where id = $1`, [cb2])).rows[0].cancelled_by === coach);
const cb3 = (await db.query(`insert into public.bookings (status, athlete_id, coach_id) values ('confirmed', $1, $2) returning id`, [fresh, coach])).rows[0].id;
await db.query(`update public.bookings set cancelled_by = $1 where id = $2`, [coach, cb3]);
expect("C7: a session still on has no canceller, whatever an update says", (await db.query(`select cancelled_by from public.bookings where id = $1`, [cb3])).rows[0].cancelled_by === null);
const hold = (email, extra = {}) =>
  db.query(
    `insert into public.public_booking_holds (coach_id, session_type_id, organization_id, start_at, end_at, expires_at, status_token_hash, guest_name, guest_email, amount_cents, stripe_account_id, state)
     values ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 1 hour', now() + interval '33 minutes', md5(random()::text), 'Hewan', $4, 6000, 'acct_1', $5) returning id`,
    [extra.coach ?? coach, typeId.id, org, email, extra.state ?? "open"]
  );
const h1 = (await hold("hewan@example.com")).rows[0].id;
let dup = null;
try { await hold("HEWAN@example.com"); } catch (e) { dup = e; }
expect("C7: one open hold per visitor per coach (any letter case)", dup !== null);
await db.query(`update public.public_booking_holds set state = 'lapsed' where id = $1`, [h1]);
let again = null;
try { await hold("hewan@example.com"); } catch (e) { again = e; }
expect("C7: after it lapses the visitor can start again", again === null);
let badEnd = null;
try {
  await db.query(`insert into public.public_booking_holds (coach_id, session_type_id, organization_id, start_at, end_at, expires_at, status_token_hash, amount_cents, stripe_account_id) values ($1, $2, $3, now(), now(), now(), 'x', 6000, 'a')`, [coach, typeId.id, org]);
} catch (e) { badEnd = e; }
expect("C7: a hold must end after it starts", badEnd !== null);
let free = null;
try { await hold("free@example.com", { state: "open" }).then(() => db.query(`update public.public_booking_holds set amount_cents = 0 where guest_email = 'free@example.com'`)); } catch (e) { free = e; }
expect("C7: a hold is always for a real amount", free !== null);
await hold("other@example.com", { coach: newCoach });
expect("C7: a coach reads only their own holds", (await as(coach, "select coach_id from public.public_booking_holds")).rows.every((r) => r.coach_id === coach) && (await as(coach, "select 1 from public.public_booking_holds")).rows.length >= 1);
expect("C7: a client reads none", (await as(fresh, "select 1 from public.public_booking_holds")).rows.length === 0);
expect("C7: signed out reads none", (await as(null, "select 1 from public.public_booking_holds")).error !== null || (await as(null, "select 1 from public.public_booking_holds")).rows.length === 0);
expect("C7: nobody signed in writes holds", (await as(coach, "update public.public_booking_holds set state = 'booked'")).error !== null);
expect("C7: nobody signed in makes holds", (await as(coach, `insert into public.public_booking_holds (coach_id, session_type_id, organization_id, start_at, end_at, expires_at, status_token_hash, amount_cents, stripe_account_id) values ('${coach}', '${typeId.id}', '${org}', now(), now() + interval '1 hour', now(), 'y', 100, 'a')`)).error !== null);
let refundTwice = null;
await db.query(`update public.public_booking_holds set refund_id = 're_1' where guest_email = 'hewan@example.com' and state = 'open'`);
try { await db.query(`update public.public_booking_holds set refund_id = 're_1' where guest_email = 'other@example.com'`); } catch (e) { refundTwice = e; }
expect("C7: one Stripe refund belongs to one hold only", refundTwice !== null);

// C7: Charge on a late change of a session paid online keeps the payment and takes no session; any other session is charged one, as before.
expect("fixture: the live function, byte for byte", liveMd5.m === "0010aa033f297f17b1feea309f052d4c");
const charge = async (paid) => {
  const b = (await db.query(`insert into public.bookings (status, athlete_id, group_id, coach_id, late_charge_state, late_change_kind) values ('cancelled', $1, $2, $3, 'flagged', 'cancel') returning id`, [fresh, group, coach])).rows[0].id;
  if (paid) await db.query(`insert into public.public_booking_holds (coach_id, session_type_id, organization_id, start_at, end_at, expires_at, status_token_hash, amount_cents, stripe_account_id, state, booking_id) values ($1, $2, $3, now(), now() + interval '1 hour', now(), md5(random()::text), 6000, 'acct_1', 'booked', $4)`, [coach, typeId.id, org, b]);
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  await db.query("select public.resolve_late_change($1, true)", [b]);
  await db.exec("commit");
  return (await db.query(`select amount from public.credit_log where booking_id = $1`, [b])).rows[0]?.amount;
};
expect("C7: Charge on a session paid online takes no session", (await charge(true)) === 0);
expect("C7: Charge on any other late change still takes one", (await charge(false)) === -1);

// The paste itself (step 218): it holds the migration word for word, runs again safely, and its check row is all true.
const apply = read("../../supabase/apply/apply-step218-0462.sql");
const undo = read("../../supabase/apply/undo-step218-0462.sql");
expect("paste: the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo: plain ASCII", !/[^\x00-\x7f]/.test(apply) && !/[^\x00-\x7f]/.test(undo));
const lastRow = (results) => results[results.length - 1].rows[0];
const allTrue = (row) => row && Object.values(row).every((v) => v === true);
await db.query(`delete from public.public_booking_holds`);
await db.query(`update public.profiles set quiet_hours_default_pending = false`);
expect("paste: check row all true", allTrue(lastRow(await db.exec(apply))));

// The undo refuses once anyone has paid, and changes nothing.
await hold("paid@example.com", { state: "booked" });
let refused = null;
try { await db.exec(undo); } catch (e) { refused = e; }
expect("undo: refuses once a visitor has paid", refused !== null && /payment records are kept/.test(String(refused?.message)));
try { await db.exec("rollback"); } catch {}
expect("undo: a refusal changes nothing", (await db.query(`select count(*)::int as n from public.public_booking_holds`)).rows[0].n === 1);
await db.query(`delete from public.public_booking_holds`);
expect("undo: check row all true", allTrue(lastRow(await db.exec(undo))));
expect("undo: Charge is back exactly as it was (line endings aside)", (await lateMd5()).lf === liveMd5.lf);
expect("paste: applies again after the undo", allTrue(lastRow(await db.exec(apply))));

if (failures.length) {
  console.error("FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("OK: step 218 rehearsal passed");
