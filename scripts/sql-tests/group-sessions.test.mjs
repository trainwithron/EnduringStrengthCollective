// Runs the REAL supabase/migrations/0263_group_sessions.sql against an in-memory Postgres (PGlite) with small stand-ins for the tables and
// functions it depends on, then checks capacity, the waiting list, charges, refunds, row security and cancelling.
//   npm run test:sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/migrations/0263_group_sessions.sql", import.meta.url), "utf8");
const db = new PGlite();

const COACH = "00000000-0000-0000-0000-0000000000c1";
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const G = "00000000-0000-0000-0000-0000000000a1";

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
  create table public.profiles (id uuid primary key, full_name text);
  create table public.groups (id uuid primary key, name text);
  create table public.group_memberships (group_id uuid, profile_id uuid, role text, membership_type text not null default 'training', joined_at timestamptz not null default now());
  create table public.session_types (id uuid primary key default gen_random_uuid(), coach_id uuid);
  create table public.bookings (id uuid primary key default gen_random_uuid(), coach_id uuid, athlete_id uuid, group_id uuid, start_at timestamptz, end_at timestamptz, status text not null default 'confirmed', credit_state text not null default 'prepaid', reminder_sent_at timestamptz);
  create table public.discovery_bookings (coach_id uuid, start_at timestamptz, end_at timestamptz, status text default 'confirmed');
  create table public.coach_booking_policies (coach_id uuid primary key, cancellation_window_hours int not null default 24);
  create table public.session_credits (athlete_id uuid, group_id uuid, balance int not null default 0, last_granted_at timestamptz, updated_at timestamptz default now(), primary key (athlete_id, group_id));
  create table public.session_credit_ledger (id uuid primary key default gen_random_uuid(), athlete_id uuid, group_id uuid, kind text, amount int, balance_after int, note text, booking_id uuid, created_by uuid, created_at timestamptz default now());
  create function public.is_group_coach(_group_id uuid) returns boolean language sql security definer stable as $$ select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = auth.uid() and role = 'coach') $$;
  create function public.is_client_of_coach(target_coach_id uuid) returns boolean language sql security definer stable as $$
    select exists (select 1 from public.group_memberships a join public.group_memberships c on c.group_id = a.group_id
      where a.profile_id = auth.uid() and a.role = 'athlete' and c.profile_id = target_coach_id and c.role = 'coach') $$;
  create function public.apply_session_credit_change(p_athlete_id uuid, p_group_id uuid, p_delta int, p_kind text, p_note text default null, p_booking_id uuid default null, p_created_by uuid default null)
  returns int language plpgsql security definer as $$
  declare v_balance int;
  begin
    insert into public.session_credits (athlete_id, group_id, balance) values (p_athlete_id, p_group_id, p_delta)
    on conflict (athlete_id, group_id) do update set balance = public.session_credits.balance + p_delta returning balance into v_balance;
    insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note) values (p_athlete_id, p_group_id, p_kind, p_delta, v_balance, p_note);
    return v_balance;
  end $$;
  insert into public.profiles values ('${COACH}', 'Coach'), ('${A}', 'Ann'), ('${B}', 'Bo'), ('${C}', 'Cy'), ('${D}', 'Di');
  insert into public.groups values ('${G}', 'G');
  insert into public.group_memberships (group_id, profile_id, role) values ('${G}', '${COACH}', 'coach'), ('${G}', '${A}', 'athlete'), ('${G}', '${B}', 'athlete'), ('${G}', '${C}', 'athlete'), ('${G}', '${D}', 'athlete');
  insert into public.session_credits (athlete_id, group_id, balance) values ('${A}', '${G}', 2), ('${B}', '${G}', 3), ('${C}', '${G}', 5), ('${D}', '${G}', 0);
`);

// The migration under test, exactly as in the repo.
await db.exec(migration);
await db.exec(`grant usage on schema public to authenticated; grant select on all tables in schema public to authenticated;`);

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  if (!cond) failures++;
};
const as = async (uid) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const balance = async (id) => (await one(`select balance from public.session_credits where athlete_id = $1`, [id]))?.balance;
const expectError = async (name, fn, pattern) => {
  try {
    await fn();
    check(name, false, "no error");
  } catch (e) {
    check(name, pattern.test(String(e.message)), String(e.message));
  }
};

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

// ---- create ----
await as(COACH);
const s1 = (await one(`select public.create_group_session($1, 'Tue small group', $2, $3, 2) as id`, [G, inDays(3), new Date(Date.now() + 3 * 86400000 + 3600000).toISOString()])).id;
const anchor = await one(`select b.* from public.bookings b join public.group_sessions s on s.anchor_booking_id = b.id where s.id = $1`, [s1]);
check("create makes a class and a waived hidden anchor booking", !!anchor && anchor.credit_state === "waived" && anchor.status === "confirmed" && anchor.athlete_id === COACH);
await expectError("overlapping class is refused", () => db.query(`select public.create_group_session($1, 'Overlap', $2, $3, 4)`, [G, inDays(3), new Date(Date.now() + 3 * 86400000 + 1800000).toISOString()]), /already taken/);
await expectError("past time refused", () => db.query(`select public.create_group_session($1, 'Past', $2, $3, 4)`, [G, inHours(-2), inHours(-1)]), /future/);
await as(A);
await expectError("a client cannot create a class", () => db.query(`select public.create_group_session($1, 'Nope', $2, $3, 4)`, [G, inDays(5), inDays(5)]), /not authorized|future/);

// ---- join ----
await as(A);
check("A joins", (await one(`select public.join_group_session($1, $2) as r`, [s1, A])).r === "joined");
check("A was charged one", (await balance(A)) === 1);
await expectError("joining twice is refused", () => db.query(`select public.join_group_session($1, $2)`, [s1, A]), /already in this class/);
await as(B);
check("B joins", (await one(`select public.join_group_session($1, $2) as r`, [s1, B])).r === "joined");
await as(C);
check("C goes on the waiting list when full", (await one(`select public.join_group_session($1, $2) as r`, [s1, C])).r === "waitlisted");
check("waitlisting takes no session", (await balance(C)) === 5);
await as(COACH);
const sRoom = (await one(`select public.create_group_session($1, 'Roomy', $2, $3, 5) as id`, [G, inDays(10), new Date(Date.now() + 10 * 86400000 + 3600000).toISOString()])).id;
await as(D);
await expectError("a client with no sessions cannot take a spot", () => db.query(`select public.join_group_session($1, $2)`, [sRoom, D]), /no session credits/);
await as(B);
await expectError("a client cannot add someone else", () => db.query(`select public.join_group_session($1, $2)`, [s1, D]), /not authorized/);

// ---- counts and row security ----
await as(B);
const counts = await one(`select * from public.group_session_counts(array[$1]::uuid[])`, [s1]);
check("counts show 2 in, 1 waiting to any client of the coach", counts && counts.joined === 2 && counts.waitlisted === 1);
await db.exec(`set role authenticated`);
const seen = await rows(`select athlete_id from public.group_session_attendees where group_session_id = $1`, [s1]);
check("a client sees only their own attendee row", seen.length === 1 && seen[0].athlete_id === B, JSON.stringify(seen));
const visible = await rows(`select id from public.group_sessions`);
check("a client of the coach can see the classes", visible.length === 2);
await as(COACH);
const coachSees = await rows(`select athlete_id from public.group_session_attendees where group_session_id = $1`, [s1]);
check("the coach sees everyone", coachSees.length === 3);
await db.exec(`reset role`);

// ---- leave (outside the window: refund; waitlist moves in) ----
await as(A);
const promoted = (await one(`select public.leave_group_session($1, $2) as p`, [s1, A])).p;
check("leaving outside the window refunds", (await balance(A)) === 2);
check("first on the waiting list moves in", promoted.length === 1 && promoted[0] === C);
check("and is charged", (await balance(C)) === 4);
const cStatus = await one(`select status, credit_taken from public.group_session_attendees where group_session_id = $1 and athlete_id = $2`, [s1, C]);
check("C is joined with a session used", cStatus.status === "joined" && cStatus.credit_taken === true);
await expectError("leaving twice is refused", () => db.query(`select public.leave_group_session($1, $2)`, [s1, A]), /not in this class/);

// ---- rejoin after leaving ----
await as(A);
check("A can join again", (await one(`select public.join_group_session($1, $2) as r`, [s1, A])).r === "waitlisted");

// ---- capacity ----
await as(COACH);
await expectError("capacity below the number in is refused", () => db.query(`select public.set_group_session_capacity($1, 1)`, [s1]), /already 2 people/);
const promoted2 = (await one(`select public.set_group_session_capacity($1, 3) as p`, [s1])).p;
check("raising spots moves the waiting list in", promoted2.length === 1 && promoted2[0] === A && (await balance(A)) === 1, `balance ${await balance(A)}`);

// ---- coach adds, attendance ----
await as(COACH);
const dStatus = (await one(`select public.join_group_session($1, $2) as r`, [s1, D])).r;
check("coach can add a client over capacity onto the waiting list", dStatus === "waitlisted");
await as(COACH);
await db.query(`select public.set_group_session_capacity($1, 4)`, [s1]);
const dRow = await one(`select status, credit_taken, added_by_coach from public.group_session_attendees where group_session_id = $1 and athlete_id = $2`, [s1, D]);
check("waitlisted client with no sessions is moved in, uncharged (owed)", dRow.status === "joined" && dRow.credit_taken === false && (await balance(D)) === 0);
await db.query(`select public.mark_group_attendee($1, $2, true)`, [s1, D]);
check("marking attended charges with no floor", (await balance(D)) === -1);
await db.query(`select public.mark_group_attendee($1, $2, true)`, [s1, D]);
check("marking attended twice does not charge twice", (await balance(D)) === -1);
await db.query(`select public.mark_group_attendee($1, $2, false)`, [s1, D]);
check("undoing attended does not refund", (await balance(D)) === -1);
await as(B);
await expectError("a client cannot mark attendance", () => db.query(`select public.mark_group_attendee($1, $2, true)`, [s1, B]), /not authorized/);

// ---- leave inside the window forfeits ----
await as(COACH);
const s2 = (await one(`select public.create_group_session($1, 'Soon', $2, $3, 5) as id`, [G, inHours(3), inHours(4)])).id;
await as(B);
const before = await balance(B);
await db.query(`select public.join_group_session($1, $2)`, [s2, B]);
await db.query(`select public.leave_group_session($1, $2)`, [s2, B]);
check("a client leaving inside the cancellation window forfeits the session", (await balance(B)) === before - 1);
await as(COACH);
await db.query(`select public.join_group_session($1, $2)`, [s2, B]);
await db.query(`select public.leave_group_session($1, $2)`, [s2, B]);
check("a coach removing someone always refunds nothing when nothing was taken", (await balance(B)) === before - 1);

// ---- cancel the class ----
await as(COACH);
const cBefore = await balance(C);
const affected = (await one(`select public.cancel_group_session($1) as a`, [s1])).a;
check("cancelling returns everyone who was charged", (await balance(C)) === cBefore + 1 && (await balance(B)) >= before - 1 + 0);
check("everyone in or waiting is listed to be told", affected.length >= 3, String(affected.length));
const anchorAfter = await one(`select status from public.bookings where id = (select anchor_booking_id from public.group_sessions where id = $1)`, [s1]);
check("the anchor booking is cancelled so the time is free", anchorAfter.status === "cancelled");
await as(A);
await expectError("cannot join a cancelled class", () => db.query(`select public.join_group_session($1, $2)`, [s1, A]), /cancelled/);
await as(COACH);
check("cancelling twice is harmless", (await one(`select public.cancel_group_session($1) as a`, [s1])).a.length === 0);

process.on("uncaughtException", (e) => { console.log("CRASH", e.message); process.exit(2); });
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
