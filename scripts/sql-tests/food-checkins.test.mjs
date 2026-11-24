// Rehearses step 227 (migration 0471, Ron Nov 24: the food check-in). On an in-memory Postgres with small stand-ins shaped like live (the 48 live notice types of Nov 24, the
// live notice_kind_of and the trigger that drops a notice whose kind the person switched off, client_nutrition_flags with its 0408 policy): the paste and its check row, run twice
// (re-running is safe), who may read and write the check-ins, the answer's limits, the coach's switches, then the undo and the paste again.
//   node scripts/sql-tests/food-checkins.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, LF);
const db = new PGlite();
const failures = [];
const expect = (name, cond, extra = "") => {
  if (!cond) failures.push(name + (extra ? ` (${extra})` : ""));
};

const LIVE_TYPES = [
  "booking_request", "client_request", "client_request_answer", "coach_account_closed", "coach_departure_reminder", "comment", "content_reported", "credits_expired", "direct_message",
  "email_change_cancelled", "email_change_requested", "email_changed", "exercise_swap", "goal_answered", "goal_proposed", "gym_visitor_lead", "late_change", "macros_assigned",
  "meal_plan_try", "milestone_celebration", "minor_consent_needed", "new_training_block", "nutrition_allergies_updated", "nutrition_baseline_ready", "nutrition_preferences_changed",
  "nutrition_prompt_answered", "nutrition_target_changed", "org_announcement", "organization_invite", "partner_request", "partner_request_accepted", "payment_problem", "payment_received",
  "pr_promotion", "program_assigned", "recurring_booking_conflict", "request_decision", "schedule_applied", "schedule_request", "schedule_resumed", "session_pattern_note", "space_invite",
  "support_reply", "team_sheet_saved", "trainer_dispatch_offer", "trainer_dispatch_question", "waitlist_slot_offered", "weekly_checkin",
];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, full_name text, notices_off text[] not null default '{}');
  create table public.groups (id uuid primary key, nutrition_youth_mode boolean not null default false);
  create table public.group_memberships (group_id uuid, profile_id uuid, role text);
  create function public.is_group_coach(g uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.group_memberships where group_id = g and profile_id = auth.uid() and role = 'coach') $$;
  create table public.client_nutrition_flags (group_id uuid not null references public.groups(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, auto_off boolean not null default false, set_by uuid, updated_at timestamptz not null default now(), primary key (group_id, profile_id));
  alter table public.client_nutrition_flags enable row level security;
  create policy "client_nutrition_flags_coach_all" on public.client_nutrition_flags for all to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id) and (auto_off = false or exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_flags.group_id and gm.profile_id = client_nutrition_flags.profile_id and gm.role = 'athlete')));
  create table public.notifications (id uuid primary key default gen_random_uuid(), profile_id uuid, group_id uuid, type text not null, body text, link_path text, created_at timestamptz not null default now(),
    constraint notifications_type_check check (type = any (array[${LIVE_TYPES.map((t) => `'${t}'::text`).join(", ")}])));
`);
// The live notice_kind_of (the undo puts back exactly this body; its md5 is checked there) and the live trigger that drops a switched-off notice.
const undoSql = read("../../supabase/apply/undo-step227-0471.sql");
const liveKind = undoSql.slice(undoSql.indexOf("create or replace function public.notice_kind_of"), undoSql.indexOf("$$;", undoSql.indexOf("create or replace function public.notice_kind_of")) + 3);
await db.exec(liveKind);
await db.exec(`
  create function public.notifications_respect_switch() returns trigger language plpgsql security definer set search_path = public as $$
  begin
    if new.profile_id is not null and exists (select 1 from public.profiles p where p.id = new.profile_id and public.notice_kind_of(new.type) = any (p.notices_off)) then
      return null;
    end if;
    return new;
  end;
  $$;
  create trigger notifications_respect_switch before insert on public.notifications for each row execute function public.notifications_respect_switch();
`);
const LIVE_KIND_MD5 = "95fa7b1a9e7db12729dbbafd543e0821";
const kindMd5 = async () => (await db.query(`select md5(replace(prosrc, chr(13), '')) m from pg_proc where proname = 'notice_kind_of'`)).rows[0].m;
expect("the stand-in notice_kind_of is the live one", (await kindMd5()) === LIVE_KIND_MD5, await kindMd5());

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const coach = id(1), otherCoach = id(2), robyn = id(3), sam = id(4), group = id(10), otherGroup = id(11);
await db.query(`insert into public.profiles (id, full_name) values ($1, 'Ron Arnold'), ($2, 'Other Coach'), ($3, 'Robyn Lee'), ($4, 'Sam Ortiz')`, [coach, otherCoach, robyn, sam]);
await db.query(`insert into public.groups (id) values ($1), ($2)`, [group, otherGroup]);
await db.query(`insert into public.group_memberships values ($1, $2, 'coach'), ($1, $3, 'athlete'), ($4, $5, 'coach'), ($4, $6, 'athlete')`, [group, coach, robyn, otherGroup, otherCoach, sam]);
await db.query(`insert into public.client_nutrition_flags (group_id, profile_id, auto_off) values ($1, $2, true)`, [group, robyn]);

const lastRow = (results) => results[results.length - 1].rows;
const oneRowAllTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);
const apply = read("../../supabase/apply/apply-step227-0471.sql");
let r = lastRow(await db.exec(apply));
expect("the paste applies, one row all true", oneRowAllTrue(r), JSON.stringify(r[0]));
r = lastRow(await db.exec(apply));
expect("the paste again: still all true (re-running is safe)", oneRowAllTrue(r), JSON.stringify(r[0]));
const typeCount = async () => (await db.query(`select count(*)::int n from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check'), '''([^'']+)''::text', 'g')`)).rows[0].n;
expect("51 notice types: all 48 kept, 3 added once", (await typeCount()) === 51, String(await typeCount()));
expect("the other switch on the row is untouched", (await db.query(`select auto_off, checkins_off from public.client_nutrition_flags where profile_id = $1`, [robyn])).rows[0].auto_off === true);

// As a signed-in person.
const as = async (who, sql, params = []) => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [who ?? ""]);
    await db.exec(who ? "set local role authenticated" : "set local role anon");
    const res = await db.query(sql, params);
    await db.exec("commit");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e };
  }
};

// The job (the server key) records a check-in for each client.
await db.query(`insert into public.client_food_checkins (athlete_id, group_id, coach_id, trigger) values ($1, $2, $3, 'quiet')`, [robyn, group, coach]);
await db.query(`insert into public.client_food_checkins (athlete_id, group_id, coach_id, trigger, avg_diff_kcal, days_logged, target_kcal) values ($1, $2, $3, 'off', -412, 5, 2000)`, [sam, otherGroup, otherCoach]);
const count = (rows) => rows.length;
expect("the client reads their own check-in", count((await as(robyn, `select id from public.client_food_checkins`)).rows) === 1);
expect("the client never reads another client's", count((await as(robyn, `select id from public.client_food_checkins where athlete_id = $1`, [sam])).rows) === 0);
expect("the group's coach reads the group's", count((await as(coach, `select id from public.client_food_checkins`)).rows) === 1);
expect("another group's coach does not", count((await as(otherCoach, `select id from public.client_food_checkins where athlete_id = $1`, [robyn])).rows) === 0);
expect("a signed-out person reads nothing", (await as(null, `select id from public.client_food_checkins`)).error !== null);
expect("a client cannot add one", (await as(robyn, `insert into public.client_food_checkins (athlete_id, group_id, trigger) values ($1, $2, 'quiet')`, [robyn, group])).error !== null);
expect("a client cannot answer by writing the row (the server route does)", (await as(robyn, `update public.client_food_checkins set status = 'answered' where athlete_id = $1`, [robyn])).error !== null);
expect("a coach cannot change it by writing the row", (await as(coach, `update public.client_food_checkins set status = 'handled'`)).error !== null);
expect("nobody signed in deletes one", (await as(coach, `delete from public.client_food_checkins`)).error !== null);

const bad = async (sql, params) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};
expect("an unknown chip is refused", await bad(`update public.client_food_checkins set reasons = array['long_cook', 'free_pizza'] where athlete_id = $1`, [robyn]));
expect("the five chips are fine", !(await bad(`update public.client_food_checkins set reasons = array['long_cook', 'disliked_food', 'tracking_hassle', 'rework_plan', 'all_good'] where athlete_id = $1`, [robyn])));
expect("a note over 500 is refused", await bad(`update public.client_food_checkins set note = repeat('x', 501) where athlete_id = $1`, [robyn]));
expect("an unknown trigger is refused", await bad(`insert into public.client_food_checkins (athlete_id, group_id, trigger) values ($1, $2, 'bored')`, [robyn, group]));
expect("an unknown status is refused", await bad(`update public.client_food_checkins set status = 'ignored' where athlete_id = $1`, [robyn]));

// The coach's per-client switch.
expect("the group's coach turns check-ins off for their client", (await as(coach, `insert into public.client_nutrition_flags (group_id, profile_id, checkins_off) values ($1, $2, true) on conflict (group_id, profile_id) do update set checkins_off = true returning checkins_off`, [group, robyn])).rows[0]?.checkins_off === true);
expect("... and the other switch stays on", (await db.query(`select auto_off from public.client_nutrition_flags where profile_id = $1`, [robyn])).rows[0].auto_off === true);
expect("another group's coach cannot", (await as(otherCoach, `insert into public.client_nutrition_flags (group_id, profile_id, checkins_off) values ($1, $2, true) on conflict (group_id, profile_id) do update set checkins_off = true`, [group, robyn])).error !== null);

// The notices: a coach who switched "Client activity" off gets neither coach bell; a client always gets their check-in.
await db.query(`update public.profiles set notices_off = array['client_activity'] where id = $1`, [coach]);
await db.query(`insert into public.notifications (profile_id, group_id, type, body) values ($1, $2, 'food_checkin_answered', 'x'), ($1, $2, 'food_checkin_sent', 'x'), ($3, $2, 'food_checkin', 'x')`, [coach, group, robyn]);
const n = async (who) => (await db.query(`select type from public.notifications where profile_id = $1`, [who])).rows.map((x) => x.type);
expect("a coach with Client activity off gets no check-in bells", (await n(coach)).length === 0, JSON.stringify(await n(coach)));
expect("the client gets their check-in", JSON.stringify(await n(robyn)) === '["food_checkin"]');
await db.query(`update public.profiles set notices_off = '{}' where id = $1`, [coach]);
await db.query(`insert into public.notifications (profile_id, group_id, type, body) values ($1, $2, 'food_checkin_answered', 'x')`, [coach, group]);
expect("with it on, the coach gets the answer's bell", JSON.stringify(await n(coach)) === '["food_checkin_answered"]');

// The undo, then the paste again.
r = lastRow(await db.exec(undoSql));
expect("the undo: one row, all true", oneRowAllTrue(r), JSON.stringify(r[0]));
expect("the undo puts notice_kind_of back exactly", (await kindMd5()) === LIVE_KIND_MD5);
expect("the undo keeps all 48 live types", (await typeCount()) === 48, String(await typeCount()));
expect("the undo keeps the other switch", (await db.query(`select auto_off from public.client_nutrition_flags where profile_id = $1`, [robyn])).rows[0].auto_off === true);
r = lastRow(await db.exec(apply));
expect("the paste after the undo: all true", oneRowAllTrue(r), JSON.stringify(r[0]));

if (failures.length > 0) {
  console.error(`FAIL step 227 rehearsal:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log("ok step 227 rehearsal (paste twice, who reads and writes, the answer's limits, the switches, the coach's notice switch, undo and paste again)");
