// Rehearses step 214 (migration 0458, wave 2 calendar and team) on an in-memory Postgres: small stand-ins for the tables and helpers it touches, the LIVE cancel function as it was on
// Nov 20 (fixtures/cancel-booking-live-nov20.sql, md5 of its body 1a3f38fb5fdcf93a3767cd31bbec10fc), then the migration, twice (re-running is safe).
//   node scripts/sql-tests/wave2-calendar.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const lf = (s) => s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, full_name text);
  create table public.group_coaches (group_id uuid, coach_id uuid);
  create table public.bookings (
    id uuid primary key, coach_id uuid, athlete_id uuid, group_id uuid, start_at timestamptz, end_at timestamptz, status text default 'confirmed',
    credit_state text default 'prepaid', attended_at timestamptz, no_show boolean not null default false, late_cancel boolean not null default false,
    late_change_kind text, late_charge_state text, created_at timestamptz default now()
  );
  create table public.coach_booking_policies (coach_id uuid primary key, cancellation_window_hours int not null default 24);
  create table public.notifications (id serial primary key, profile_id uuid, group_id uuid, type text, body text, link_path text);
  create table public.session_credits (athlete_id uuid, group_id uuid, balance int, last_granted_at timestamptz, updated_at timestamptz, primary key (athlete_id, group_id));
  create table public.session_credit_ledger (id serial primary key, athlete_id uuid, group_id uuid, kind text, amount int, balance_after int, note text, booking_id uuid, created_by uuid);
  create function public.is_group_coach(p uuid) returns boolean language sql stable as $$ select exists (select 1 from public.group_coaches where group_id = p and coach_id = auth.uid()) $$;
  create function public.is_org_admin_of_group(p uuid) returns boolean language sql stable as $$ select false $$;
  create function public.booking_late_move_charged(p uuid) returns boolean language sql stable as $$ select false $$;
  create function public.offer_freed_slot_to_waitlist(a uuid, b timestamptz, c timestamptz) returns void language sql as $$ select $$;
  create function public.booking_taken(p_booking_id uuid) returns integer language sql stable security definer set search_path to 'public' as $$
    select coalesce(-sum(l.amount), 0)::int from public.session_credit_ledger l where l.booking_id = p_booking_id and l.kind in ('booked', 'delivered', 'refund', 'adjusted');
  $$;
  create function public.apply_session_credit_change(p_athlete_id uuid, p_group_id uuid, p_delta integer, p_kind text, p_note text default null, p_booking_id uuid default null, p_created_by uuid default null)
  returns integer language plpgsql security definer set search_path to 'public' as $$
  declare v_balance int;
  begin
    insert into public.session_credits (athlete_id, group_id, balance) values (p_athlete_id, p_group_id, p_delta)
    on conflict (athlete_id, group_id) do update set balance = public.session_credits.balance + p_delta returning balance into v_balance;
    insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, booking_id, created_by)
    values (p_athlete_id, p_group_id, p_kind, p_delta, v_balance, p_note, p_booking_id, coalesce(p_created_by, auth.uid()));
    return v_balance;
  end $$;
`);
// T2: the training-max tables and the two LIVE estimate writers (fixtures/training-max-live-nov20.sql; md5 of their bodies 64fe631d4c5fdb5b3a449fcc55695190 and
// af72466742549e7cb3fac0ec9917ee42), with the trigger as live has it on set_logs.
await db.exec(`
  create table public.group_memberships (group_id uuid, profile_id uuid, role text);
  create function public.is_coach_of_athlete(target_athlete_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.group_memberships gm_coach join public.group_memberships gm_athlete on gm_athlete.group_id = gm_coach.group_id
      where gm_coach.profile_id = (select auth.uid()) and gm_coach.role = 'coach' and gm_athlete.profile_id = target_athlete_id and gm_athlete.role = 'athlete');
  $$;
  create table public.athlete_sessions (id uuid primary key, athlete_id uuid, is_historical boolean default false);
  create table public.session_exercises (id uuid primary key, session_id uuid, exercise_name text);
  create table public.set_logs (id serial primary key, session_exercise_id uuid, status text, weight numeric, reps int, rpe numeric, set_type text default 'working', is_historical boolean default false, data_flag text, completed_at timestamptz default now());
  create table public.athlete_training_maxes (athlete_id uuid, exercise_name text, estimated_max numeric, source_weight numeric, source_reps int, source_rpe numeric, updated_at timestamptz, source_rpe_assumed boolean default false, primary key (athlete_id, exercise_name));
`);
await db.exec(lf(readFileSync(new URL("./fixtures/training-max-live-nov20.sql", import.meta.url), "utf8")));
await db.exec(`create trigger set_logs_recompute_training_max after insert or update on public.set_logs for each row execute function public.recompute_training_max();`);
await db.exec(lf(readFileSync(new URL("./fixtures/cancel-booking-live-nov20.sql", import.meta.url), "utf8")));
const migration = lf(readFileSync(new URL("../../supabase/migrations/0458_wave2_calendar.sql", import.meta.url), "utf8"));
await db.exec(migration);
await db.exec(migration); // re-running is safe

const coach = "11111111-1111-1111-1111-111111111111";
const client = "22222222-2222-2222-2222-222222222222";
const group = "33333333-3333-3333-3333-333333333333";
await db.query(`insert into public.profiles values ($1, 'Coach Ron'), ($2, 'Jane Smith')`, [coach, client]);
await db.query(`insert into public.group_coaches values ($1, $2)`, [group, coach]);

const failures = [];
const expect = (name, cond) => { if (!cond) failures.push(name); };
const as = async (who) => db.exec(`select set_config('request.jwt.claim.sub', '${who}', false), set_config('request.jwt.claim.role', 'authenticated', false)`);
let n = 0;
const book = async ({ hoursAhead = 5, state = "prepaid", paid = true } = {}) => {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await db.query(`insert into public.bookings (id, coach_id, athlete_id, group_id, start_at, end_at, credit_state) values ($1, $2, $3, $4, now() + make_interval(hours => $5), now() + make_interval(hours => $5 + 1), $6)`, [id, coach, client, group, hoursAhead, state]);
  if (paid) await db.query(`select public.apply_session_credit_change($1, $2, -1, 'booked', 'Booked', $3, $1)`, [client, group, id]);
  return id;
};
const balance = async () => (await db.query(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [client, group])).rows[0]?.balance ?? 0;
const row = async (id) => (await db.query(`select * from public.bookings where id = $1`, [id])).rows[0];
const lastNotice = async () => (await db.query(`select body from public.notifications order by id desc limit 1`)).rows[0]?.body ?? "";
const cancel = async (id) => { await as(client); await db.query(`select public.cancel_booking_and_refund_credit($1)`, [id]); };
const setting = async (on) => db.query(`insert into public.coach_booking_policies (coach_id, late_cancel_takes_session) values ($1, $2) on conflict (coach_id) do update set late_cancel_takes_session = $2`, [coach, on]);

// C2
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'bookings'`)).rows.map((r) => r.column_name);
expect("C2: bookings.day_before_reminded_for exists", cols.includes("day_before_reminded_for"));

// C5, setting OFF (the default): exactly as before.
await db.query(`select public.apply_session_credit_change($1, $2, 5, 'purchased', 'Pack', null, $3)`, [client, group, coach]);
const b1 = await book();
await cancel(b1);
let r = await row(b1);
expect("off: a late cancel is flagged for the coach", r.late_charge_state === "flagged" && r.late_cancel === true && r.late_charge_auto === false);
expect("off: the session taken at booking is given back", (await balance()) === 5);
expect("off: the coach is asked to Charge or Waive", (await lastNotice()).endsWith("-hour window. Charge it or waive it."));

// C5, setting ON.
await setting(true);
const b2 = await book();
expect("booking took one", (await balance()) === 4);
await cancel(b2);
r = await row(b2);
expect("on: the late cancel is taken at once, marked as by the setting", r.late_charge_state === "charged" && r.late_charge_auto === true);
expect("on: one session used, no more", (await balance()) === 4);
expect("on: the coach is told it came off, and can give it back", (await lastNotice()).includes("It came off their sessions (your late-cancel setting). Give it back on Requests if you like."));
const notes = (await db.query(`select note from public.session_credit_ledger where booking_id = $1 order by id`, [b2])).rows.map((x) => x.note);
expect("on: the client's history never says the coach decides", notes.join("|") === "Booked|Booking cancelled inside the window|Late cancellation (your coach's late-cancel rule)");

const b3 = await book({ state: "unsettled", paid: false });
await cancel(b3);
expect("on: a session the coach scheduled (unsettled) also takes one", (await balance()) === 3 && (await row(b3)).late_charge_state === "charged");

const b4 = await book({ hoursAhead: 48 });
await cancel(b4);
r = await row(b4);
expect("on: an in-time cancel is untouched (given back, not flagged)", r.late_charge_state === null && (await balance()) === 3);

// Give it back.
await as(client);
let refused = false;
try { await db.query(`select public.give_back_late_cancel($1)`, [b2]); } catch { refused = true; }
expect("give back: the client cannot", refused && (await row(b2)).late_charge_state === "charged");
await as(coach);
await db.query(`select public.give_back_late_cancel($1)`, [b2]);
expect("give back: the coach gives one session back and it reads Waived", (await balance()) === 4 && (await row(b2)).late_charge_state === "waived");
refused = false;
try { await db.query(`select public.give_back_late_cancel($1)`, [b2]); } catch { refused = true; }
expect("give back: never twice", refused && (await balance()) === 4);
refused = false;
try { await db.query(`select public.give_back_late_cancel($1)`, [b1]); } catch { refused = true; }
expect("give back: nothing to give back on one still waiting for Charge or Waive", refused);

// Who may call what.
const priv = (await db.query(`select has_function_privilege('authenticated', 'public.take_late_cancel_session(uuid)', 'execute') as take, has_function_privilege('authenticated', 'public.give_back_late_cancel(uuid)', 'execute') as give, has_function_privilege('anon', 'public.give_back_late_cancel(uuid)', 'execute') as anon_give`)).rows[0];
expect("only the cancel itself takes a session (nobody calls it directly)", priv.take === false);
expect("a signed-in coach may give back (the function checks it is theirs); anon may not", priv.give === true && priv.anon_give === false);
const def = (await db.query(`select prosrc from pg_proc where proname = 'cancel_booking_and_refund_credit'`)).rows[0].prosrc;
expect("patched once, even after running twice", def.split("take_late_cancel_session").length - 1 === 1);

// T2: a tested max, locked.
const other = "44444444-4444-4444-4444-444444444444";
await db.query(`insert into public.group_memberships values ($1, $2, 'coach'), ($1, $3, 'athlete')`, [group, coach, client]);
await db.query(`insert into public.athlete_sessions values ('55555555-5555-5555-5555-555555555555', $1, false)`, [client]);
await db.query(`insert into public.session_exercises values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'Back Squat')`);
const logSet = (weight, reps) => db.query(`insert into public.set_logs (session_exercise_id, status, weight, reps, rpe) values ('66666666-6666-6666-6666-666666666666', 'completed', $1, $2, 10)`, [weight, reps]);
const squat = async () => (await db.query(`select * from public.athlete_training_maxes where athlete_id = $1 and exercise_name = 'Back Squat'`, [client])).rows[0] ?? null;
await logSet(200, 5);
expect("T2: a logged set makes the estimate as before", Number((await squat()).estimated_max) === 233.3 && (await squat()).locked === false);
await as(other);
refused = false;
try { await db.query(`select public.set_tested_max($1, 'Back Squat', 300)`, [client]); } catch { refused = true; }
expect("T2: only a coach of the athlete may set it", refused);
await as(client);
refused = false;
try { await db.query(`select public.set_tested_max($1, 'Back Squat', 300)`, [client]); } catch { refused = true; }
expect("T2: the athlete may not set their own", refused);
await as(coach);
refused = false;
try { await db.query(`select public.set_tested_max($1, 'Back Squat', 0)`, [client]); } catch { refused = true; }
expect("T2: a nonsense weight is refused", refused);
await db.query(`select public.set_tested_max($1, '  Back Squat ', 225)`, [client]);
let tm = await squat();
expect("T2: the coach's tested max replaces the estimate and is locked, with who and when", Number(tm.estimated_max) === 225 && tm.locked === true && tm.tested_by === coach && tm.tested_at !== null);
await logSet(260, 5);
expect("T2: a heavier logged set does not overwrite a locked max", Number((await squat()).estimated_max) === 225);
await db.query(`select public.recompute_training_maxes_internal($1, null)`, [client]);
expect("T2: the full recompute leaves a locked max alone", Number((await squat()).estimated_max) === 225 && (await squat()).locked === true);
await db.query(`delete from public.set_logs`);
await db.query(`select public.recompute_training_maxes_internal($1, 'Back Squat')`, [client]);
expect("T2: and never deletes it, even with nothing logged", (await squat()) !== null && Number((await squat()).estimated_max) === 225);
await logSet(260, 5);
await db.query(`select public.unlock_tested_max($1, 'Back Squat')`, [client]);
tm = await squat();
expect("T2: unlocking goes back to the estimate from logged sets", tm.locked === false && Number(tm.estimated_max) === 303.3 && tm.tested_by === null);
const tmPriv = (await db.query(`select has_function_privilege('anon', 'public.set_tested_max(uuid, text, numeric)', 'execute') as anon_set, has_function_privilege('authenticated', 'public.set_tested_max(uuid, text, numeric)', 'execute') as auth_set`)).rows[0];
expect("T2: signed-in only (the function checks it is the athlete's coach)", tmPriv.anon_set === false && tmPriv.auth_set === true);
const tmDefs = (await db.query(`select string_agg(prosrc, ' ') d from pg_proc where proname in ('recompute_training_max', 'recompute_training_maxes_internal')`)).rows[0].d;
expect("T2: each estimate writer patched once, even after running twice", tmDefs.split("not public.athlete_training_maxes.locked").length - 1 === 2 && tmDefs.split("and not m.locked").length - 1 === 1);

// The paste files themselves: the undo puts the three live functions back exactly (same md5 as live on Nov 20) and removes the rest; the paste then applies cleanly again and its
// check row is all true; and the paste holds the migration word for word.
const md5s = async () => (await db.query(`select proname, md5(prosrc) m from pg_proc where proname in ('cancel_booking_and_refund_credit', 'recompute_training_max', 'recompute_training_maxes_internal') order by proname`)).rows.map((x) => `${x.proname}:${x.m}`).join(" ");
const undo = lf(readFileSync(new URL("../../supabase/apply/undo-step214-0458.sql", import.meta.url), "utf8"));
const paste = lf(readFileSync(new URL("../../supabase/apply/apply-step214-0458.sql", import.meta.url), "utf8"));
expect("the paste is the migration word for word", paste.includes(migration));
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await db.exec(undo);
expect(
  "undo: the three functions are exactly the live ones again",
  (await md5s()) === "cancel_booking_and_refund_credit:1a3f38fb5fdcf93a3767cd31bbec10fc recompute_training_max:64fe631d4c5fdb5b3a449fcc55695190 recompute_training_maxes_internal:af72466742549e7cb3fac0ec9917ee42"
);
const leftover = (await db.query(`select count(*)::int n from pg_proc where proname in ('take_late_cancel_session', 'give_back_late_cancel', 'set_tested_max', 'unlock_tested_max')`)).rows[0].n;
expect("undo: the new functions are gone", leftover === 0);
const results = await db.exec(paste);
const checkRow = results[results.length - 1].rows[0];
expect(`paste: the check row is all true (${JSON.stringify(checkRow)})`, Object.values(checkRow).length === 8 && Object.values(checkRow).every((v) => v === true));

if (failures.length) {
  console.error("FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("OK: step 214 rehearsal passed");
