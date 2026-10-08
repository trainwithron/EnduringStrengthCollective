// Builds the numbered paste-ready SQL files under supabase/apply/ from the migration files: for each step a read-only PRECHECK file (every row
// must say ok = true) and the APPLY file (begin ... commit, so it is all or nothing). Nothing in them searches existing text.
//   node scripts/build-paste-files.mjs
// scripts/sql-tests/paste-files.test.mjs applies every step in order on the live-equivalent schema and checks each precheck is true first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkSql as functionAclCheckSql, undoSql as functionAclUndoSql } from "./function-acl.mjs";
import { probeSql as step23ProbeSql } from "./step23-probe.mjs";

const root = new URL("../supabase/", import.meta.url);
const outDir = new URL("apply/", root);
mkdirSync(outDir, { recursive: true });

import { readdirSync } from "node:fs";
const index = {};
for (const f of readdirSync(new URL("migrations/", root))) if (/^\d{4}_/.test(f)) index[f.slice(0, 4)] = f;
const migrationSql = (n) => readFileSync(new URL(`migrations/${index[n]}`, root), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "");

// The text of one function as 0248 defines it (the version live today), for the undo files of the steps that replace it.
const fnFromMigration = (mig, name) => {
  const text = migrationSql(mig);
  const start = text.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${mig} has no ${name}`);
  const m = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(text.slice(start));
  if (!m) throw new Error(`${mig} ${name} has no body delimiter`);
  const tag = m[1];
  const open = start + m.index + m[0].length;
  const end = text.indexOf(tag + ";", open) + tag.length + 1;
  return text.slice(start, end);
};
const fnFrom0248 = (name) => fnFromMigration("0248", name);
const fnFrom0218 = (name) => fnFromMigration("0218", name);
const fnFrom0277 = (name) => fnFromMigration("0277", name);
const md5Is = (sig, md5) => `coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '${md5}' from pg_proc p where p.oid = to_regprocedure('public.${sig}')), false)`;

const has = {
  table: (t) => `to_regclass('public.${t}') is not null`,
  noTable: (t) => `to_regclass('public.${t}') is null`,
  fn: (sig) => `to_regprocedure('public.${sig}') is not null`,
  fnName: (n) => `exists (select 1 from pg_proc where proname = '${n}' and pronamespace = 'public'::regnamespace)`,
  col: (t, c) => `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${t}' and column_name = '${c}')`,
  noCol: (t, c) => `not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${t}' and column_name = '${c}')`,
  policy: (t, p) => `exists (select 1 from pg_policies where schemaname = 'public' and tablename = '${t}' and policyname = '${p}')`,
  noPolicy: (t, p) => `not exists (select 1 from pg_policies where schemaname = 'public' and tablename = '${t}' and policyname = '${p}')`,
};

const STEPS = [
  {
    n: "01",
    slug: "0249-0250-0254-0240-0241",
    title: "0249 coach completion message, 0250 AI allowance scaling, 0254 client tag write rules, 0240 guide dismissal, 0241 program label and order",
    migrations: ["0249", "0250", "0254", "0240", "0241"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. Coaches' AI allowances now scale with client count (free-access orgs get 0.3); only an owner or admin can create or change client tags; clients can pick a program label.",
    rows: [
      ["coach_profiles table exists (0249)", has.table("coach_profiles")],
      ["0245 is applied: ai_charges, ai_usage_log and coach_credits exist (0250 builds on them)", `${has.table("ai_charges")} and ${has.table("ai_usage_log")} and ${has.table("coach_credits")}`],
      ["organization_billing and organization_memberships exist (0250, 0254)", `${has.table("organization_billing")} and ${has.table("organization_memberships")}`],
      ["spend_ai_action and reserve_ai_call exist (0250 replaces them)", `${has.fnName("spend_ai_action")} and ${has.fnName("reserve_ai_call")} and ${has.fnName("coach_client_steps")}`],
      ["client_tags and client_tag_assignments exist (0254)", `${has.table("client_tags")} and ${has.table("client_tag_assignments")} and ${has.fnName("is_org_member")}`],
      ["0254 is not already applied", has.noPolicy("client_tags", "client_tags_insert_owner_admin")],
      ["programs and profiles tables exist (0240, 0241)", `${has.table("programs")} and ${has.table("profiles")}`],
    ],
  },
  {
    n: "02",
    slug: "0244-0255-0256-0257-0258",
    title: "0244 macro target history and row security, 0255 legal acceptances and locked waiver, 0256 marketplace listing opt-in, 0257 feedback reports, 0258 help-search log",
    migrations: ["0244", "0255", "0256", "0257", "0258"],
    sees: "Success. No rows returned.",
    afterwards: "Standing macro targets are kept as dated history (existing targets are carried over). A client can no longer rewrite a completed waiver. Public coach listing is off for every organization until its owner switches it on. The Report a problem list and the Ask Spot unanswered-question log start recording.",
    rows: [
      ["client_macro_targets exists (0239 is applied)", has.table("client_macro_targets")],
      ["0244 is not already applied", has.noTable("client_macro_target_history")],
      ["client_intake exists and is_group_coach exists (0255)", `${has.table("client_intake")} and ${has.fnName("is_group_coach")}`],
      ["0255 is not already applied", has.noTable("legal_acceptances")],
      ["organizations exists (0256)", has.table("organizations")],
      ["is_platform_admin() exists (0257, 0258)", has.fn("is_platform_admin()")],
      ["0257 and 0258 are not already applied", `${has.noTable("feedback_reports")} and ${has.noTable("nav_query_log")}`],
    ],
  },
  {
    n: "03",
    slug: "0259-0260-0261-0262",
    title: "0259 ongoing weekly series, 0260 payment holds and re-up reminders, 0261 public booking page tables, 0262 job monitoring",
    migrations: ["0259", "0260", "0261", "0262"],
    sees: "Success. No rows returned.",
    afterwards: "Weekly schedules can run with no end date; the Needs payment panel gets Hold and Remind; a coach can switch on a public booking page; scheduled jobs start recording their runs.",
    rows: [
      ["0248 is applied (bookings.credit_state exists)", has.col("bookings", "credit_state")],
      ["recurring_booking_series, session_credits, coach_booking_policies, session_types exist", `${has.table("recurring_booking_series")} and ${has.table("session_credits")} and ${has.table("coach_booking_policies")} and ${has.table("session_types")}`],
      ["is_platform_admin() exists", has.fn("is_platform_admin()")],
      ["0261 and 0262 are not already applied", `${has.noTable("coach_booking_pages")} and ${has.noTable("cron_runs")}`],
    ],
  },
  {
    n: "04",
    slug: "0263",
    title: "0263 small-group sessions with spots, waiting list and charges",
    migrations: ["0263"],
    sees: "Success. No rows returned.",
    afterwards: "Coaches get Group Sessions (schedule a class with spots); clients get a Classes page and one-tap Join.",
    rows: [
      ["0246 and 0248 are applied (credit functions exist)", `${has.fnName("apply_session_credit_change")} and ${has.fnName("settle_booking_internal")} and ${has.col("bookings", "credit_state")}`],
      ["bookings, session_types, coach_booking_policies, session_credits, session_credit_ledger exist", `${has.table("bookings")} and ${has.table("session_types")} and ${has.table("coach_booking_policies")} and ${has.table("session_credits")} and ${has.table("session_credit_ledger")}`],
      ["is_group_coach and is_client_of_coach exist", `${has.fnName("is_group_coach")} and ${has.fnName("is_client_of_coach")}`],
      ["0263 is not already applied", has.noTable("group_sessions")],
    ],
  },
  {
    n: "05",
    slug: "0236",
    title: "0236 workout session integrity: one log per workout however many times Finish is tapped, no edits to a completed workout, atomic resumable start",
    migrations: ["0236"],
    sees: "Success. No rows returned.",
    afterwards: "Tapping Finish twice no longer creates a second workout log, post or session charge; a client cannot edit a workout after completing it (the coach still can); Start Workout is one safe step that Resume can pick up.",
    rows: [
      ["0248 is applied (bookings.credit_state exists)", has.col("bookings", "credit_state")],
      ["complete_workout_session is the 0248 version (it settles bookings)", `coalesce((select position('settle_booking_internal' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'complete_workout_session' and p.pronamespace = 'public'::regnamespace), false)`],
      ["0236 is not already applied (no unique index on workout_logs.session_id)", `not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workout_logs_session_id_key')`],
      ["no workout session has two logs already (the unique index would fail)", `not exists (select 1 from public.workout_logs where session_id is not null group by session_id having count(*) > 1)`],
    ],
  },
  {
    n: "06",
    slug: "0251",
    title: "0251 kiosk PINs stored hashed with a five-wrong-tries lockout",
    migrations: ["0251"],
    sees: "Success. No rows returned.",
    afterwards: "Existing kiosk PINs still work (they are copied across hashed). Then run supabase/ron-test-kiosk-checkin.md BEFORE the next step (0252, which removes the old plain-text column).",
    rows: [
      ["group_memberships.kiosk_pin exists (the plain column the PINs are copied from)", has.col("group_memberships", "kiosk_pin")],
      ["pgcrypto is available on this database", `exists (select 1 from pg_available_extensions where name = 'pgcrypto')`],
      ["the extensions schema exists", `exists (select 1 from pg_namespace where nspname = 'extensions')`],
      ["is_group_coach exists", has.fnName("is_group_coach")],
      ["0251 is not already applied", has.noTable("kiosk_pins")],
    ],
  },
  {
    n: "07",
    slug: "0252",
    title: "0252 remove the plain-text kiosk PIN column (ONLY after the kiosk test passed)",
    migrations: ["0252"],
    warn: "Do NOT run this until supabase/ron-test-kiosk-checkin.md passed, and the live site's deployed code is at least commit 0019772 (it reads PINs through the hashed functions). After this the old column cannot be recovered except from a backup.",
    sees: "Success. No rows returned.",
    afterwards: "The plain-text PIN column no longer exists; check-in and PIN setting keep working through the hashed table.",
    rows: [
      ["0251 is applied (kiosk_pins and verify_kiosk_pin exist)", `${has.table("kiosk_pins")} and ${has.fnName("verify_kiosk_pin")} and ${has.fnName("set_kiosk_pin")}`],
      ["every athlete's old plain PIN has a hashed copy (no PIN would be lost)", `not exists (select 1 from public.group_memberships gm where gm.kiosk_pin is not null and gm.role = 'athlete' and not exists (select 1 from public.kiosk_pins kp where kp.group_id = gm.group_id and kp.athlete_id = gm.profile_id))`],
    ],
  },
  {
    n: "08",
    slug: "0237-0242",
    title: "0237 join a group with an invite code (checked in the database), 0242 cancelling invite links",
    migrations: ["0237", "0242"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for a person joining yet (the old way still works until step 09). Then run supabase/ron-test-invite-join.md BEFORE step 09 (0238).",
    rows: [
      ["group_invites and client_invites exist", `${has.table("group_invites")} and ${has.table("client_invites")}`],
      ["groups.group_kind exists and get_invite_info / has_valid_group_invite exist", `${has.col("groups", "group_kind")} and ${has.fnName("get_invite_info")} and ${has.fnName("has_valid_group_invite")}`],
      ["0237 is not already applied", `not ${has.fnName("join_group_with_invite")}`],
      ["0242 is not already applied", has.noCol("group_invites", "revoked_at")],
    ],
  },
  {
    n: "09",
    slug: "0238",
    title: "0238 close the old self-join (LAST, after the invite-join test passed)",
    migrations: ["0238"],
    warn: "Do NOT run this until supabase/ron-test-invite-join.md passed, and the live site's deployed code is at least commit 0019772 (the invite page must call join_group_with_invite). If the deployed app is older, every invite link would stop working.",
    sees: "Success. No rows returned.",
    afterwards: "People can only join a group through the invite function; coaches adding people and org admins adding themselves as coach are unchanged. Open one fresh invite link to confirm joining still works. If joining breaks, run supabase/apply/undo-step09-0238.sql and tell Spot.",
    rows: [
      ["0237 and 0242 are applied (join_group_with_invite exists, group_invites.revoked_at exists)", `${has.fnName("join_group_with_invite")} and ${has.col("group_invites", "revoked_at")}`],
      ["the loose self-join policy is still there (0238 is not already applied)", has.policy("group_memberships", "memberships_insert_coach_or_self")],
    ],
  },
  {
    n: "10",
    slug: "0268",
    title: "0268 guard fixes: a client's new session cannot start pre-flagged, workout totals recompute correctly, audit rows stop copying message text",
    migrations: ["0268"],
    sees: "Success. No rows returned.",
    afterwards: "A client's own new workout always starts as self-logged; editing an imported session still updates its totals; blocked rewrites of messages are recorded without the text; the service role can no longer write the audit log; the duplicate set-logs recompute trigger is gone.",
    rows: [
      ["0266 and 0267 are applied (the guards and audit_blocked exist)", `${has.fnName("guard_workout_log_columns")} and ${has.fnName("audit_blocked")} and ${has.table("audit_log")}`],
      ["recompute_workout_log exists", has.fnName("recompute_workout_log")],
      ["0268 is not already applied", `not ${has.fnName("guard_athlete_session_insert")}`],
    ],
  },
  {
    n: "11",
    slug: "0269",
    title: "0269 group session fixes: owed on promotion, not after start, credits in the right group, held time cannot be cancelled or double-booked",
    migrations: ["0269"],
    sees: "Success. No rows returned.",
    afterwards: "Group classes behave as designed: the waiting list charges (owed if no sessions), nobody is moved into a started class, the class's hidden booking cannot be cancelled through the ordinary booking functions, and new bookings are checked against classes inside the database.",
    rows: [
      ["0263 is applied (group_sessions and discovery_bookings exist)", `${has.table("group_sessions")} and ${has.table("discovery_bookings")}`],
      ["0248 is applied (bookings.credit_state exists)", has.col("bookings", "credit_state")],
      ["0269 is not already applied", `not ${has.fnName("guard_group_session_bookings")}`],
    ],
  },
  {
    n: "12",
    slug: "0270",
    title: "0270 a coach can only add their own clients to a group (closes the hole that lets any coach add any user)",
    migrations: ["0270"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes for normal use: coaches still add their own clients to other groups, owners and admins still add themselves as coach, and invite links still work. A coach can no longer put a stranger into their group to read that person's private details.",
    undo: `drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;
create policy "memberships_insert_coach_or_self" on public.group_memberships for insert
  to authenticated
  with check (
    is_group_coach(group_id)
    or ((profile_id = (select auth.uid())) and role = 'coach' and is_org_admin_of_group(group_id))
  );`,
    undoWhy: "Only if adding a client to a group, or an owner adding themselves as coach, stops working after step 12. Restores the previous rule (the one 0238 created).",
    rows: [
      ["0238 is applied (the loose self-join is gone)", `${has.policy("group_memberships", "memberships_insert_coach_or_self")} and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check like '%has_valid_group_invite%')`],
      ["is_coach_of_athlete and is_org_admin_of_group exist", `${has.fnName("is_coach_of_athlete")} and ${has.fnName("is_org_admin_of_group")}`],
      ["0270 is not already applied", `exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check not like '%is_coach_of_athlete%')`],
    ],
  },
  {
    n: "13",
    slug: "0271",
    title: "0271 database functions are runnable by signed-in users and the server only (not by the public internet), except the three the public pages call",
    migrations: ["0271"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. Signed-in people, row security and the server keep working. A signed-out visitor can still open an invite page and still use the discovery-call and gym QR forms (those two are closed later, by step 17, after a deploy). Open the live site signed in as a coach and as a client and check Home, the calendar and one booking.",
    undo: `grant execute on all functions in schema public to public, anon, authenticated, service_role;
alter default privileges grant execute on functions to public;
alter default privileges in schema public grant execute on functions to anon;`,
    undoWhy: "Only if something breaks that worked before step 13 (for example a page that signs the visitor out and shows 'permission denied for function'). Puts function permissions back exactly as they were (everyone can run everything). Tell Spot which page failed.",
    rows: [
      ["the helper functions row security uses exist", `${has.fnName("is_group_coach")} and ${has.fnName("is_group_member")} and ${has.fnName("is_org_member")} and ${has.fnName("is_platform_admin")}`],
      ["the three public pages' functions exist", `${has.fnName("get_invite_info")} and ${has.fnName("book_discovery_call")} and ${has.fnName("submit_gym_visitor_lead")}`],
      ["0271 is not already applied (the signed-out role can still run most functions today)", `(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')) > 10`],
    ],
  },
  {
    n: "14",
    slug: "0273",
    title: "0273 guards on groups and organizations: ownership, the platform fee, moving a group, the one-on-one rule",
    migrations: ["0273"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes for normal use: renaming, branding, focus tag, team mode, switching a group's kind and transferring ownership all still work. An organization admin can no longer make themselves the owner with a plain update, and a coach can no longer move a group to another organization or turn a group of several clients into a one-on-one space.",
    undo: `drop trigger if exists organizations_guard_columns on public.organizations;
drop trigger if exists groups_guard_columns on public.groups;
drop function if exists public.guard_organization_columns();
drop function if exists public.guard_group_columns();`,
    undoWhy: "Only if renaming a group, saving branding or transferring ownership stops working after step 14. Removes the two guards.",
    rows: [
      ["organizations.platform_fee_pct exists and is_platform_admin() exists", `${has.col("organizations", "platform_fee_pct")} and ${has.fn("is_platform_admin()")}`],
      ["groups.group_kind exists", has.col("groups", "group_kind")],
      ["0273 is not already applied (no guard triggers yet)", `not exists (select 1 from pg_trigger where tgname in ('organizations_guard_columns', 'groups_guard_columns'))`],
    ],
  },
  {
    n: "15",
    slug: "0274",
    title: "0274 a completed workout is locked against added or deleted sets and against being reopened by the client",
    migrations: ["0274"],
    sees: "Success. No rows returned.",
    afterwards: "Finishing a workout works as before. After Finish a client can no longer add or delete sets of that workout or reopen it (the coach still can, history imports are unaffected). A tab left open that tries to save after Finish shows the existing 'already completed' message.",
    undo: `create or replace function public.block_athlete_edits_to_completed_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.session_status;
  v_group uuid;
  v_historical boolean;
begin
  -- Internal/admin calls (no signed-in user) and the service role are not blocked.
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  select s.status, s.group_id, s.is_historical
    into v_status, v_group, v_historical
  from public.athlete_sessions s
  join public.session_exercises se on se.session_id = s.id
  where se.id = new.session_exercise_id;

  if v_status = 'completed' and not coalesce(v_historical, false)
     and not coalesce(public.is_group_coach(v_group), false) then
    raise exception 'This workout was already completed.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_edits_to_completed_session on public.set_logs;
create trigger trg_block_edits_to_completed_session
  before update on public.set_logs
  for each row execute function public.block_athlete_edits_to_completed_session();

create or replace function public.guard_athlete_session_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    perform public.audit_blocked('athlete_sessions', old.id::text, to_jsonb(old), to_jsonb(new),
      array['logged_by_coach', 'deduct_session_credit', 'booking_id', 'is_historical', 'session_type_id', 'athlete_id', 'group_id', 'workout_id']);
    new.logged_by_coach := old.logged_by_coach;
    new.deduct_session_credit := old.deduct_session_credit;
    new.booking_id := old.booking_id;
    new.is_historical := old.is_historical;
    new.session_type_id := old.session_type_id;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.workout_id := old.workout_id;
  end if;
  return new;
end;
$$;`,
    undoWhy: "Only if finishing or logging a workout breaks after step 15. Puts back the previous rule (only edits are blocked after Finish).",
    rows: [
      ["0236 is applied (the completed-workout trigger exists)", `exists (select 1 from pg_trigger where tgname = 'trg_block_edits_to_completed_session')`],
      ["0266 and 0267 are applied (the athlete session guard exists and records blocked writes)", `coalesce((select position('audit_blocked' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'guard_athlete_session_columns' and p.pronamespace = 'public'::regnamespace), false)`],
      ["0274 is not already applied (the lock only covers updates today)", `coalesce((select position('tg_op' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'block_athlete_edits_to_completed_session' and p.pronamespace = 'public'::regnamespace), false)`],
    ],
  },
  {
    n: "16",
    slug: "0275",
    title: "0275 a client's cancel or move of one week of an ongoing weekly schedule stays skipped (so the nightly top-up does not book it back)",
    migrations: ["0275"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. When a client cancels or moves one session of a no-end-date weekly schedule, that week is no longer booked again the next morning.",
    undo: `drop trigger if exists bookings_note_series_skip on public.bookings;
drop function if exists public.note_series_session_skipped();`,
    undoWhy: "Only if cancelling or moving a booking starts failing after step 16. Removes the trigger.",
    rows: [
      ["0259 is applied (recurring_booking_series.skipped_starts and mode exist)", `${has.col("recurring_booking_series", "skipped_starts")} and ${has.col("recurring_booking_series", "mode")}`],
      ["bookings.recurring_series_id exists", has.col("bookings", "recurring_series_id")],
      ["0275 is not already applied", `not exists (select 1 from pg_trigger where tgname = 'bookings_note_series_skip')`],
    ],
  },
  {
    n: "17",
    slug: "0272",
    title: "0272 the discovery-call and gym QR functions are server-only (ONLY after the release with the two new server routes is deployed)",
    migrations: ["0272"],
    warn: "Do NOT run this until the release that contains /api/public/discovery-book and /api/public/gym-lead is deployed AND step 13 (0271) is applied. If you run it first, the public discovery-call page and the gym QR form show an error until the deploy.",
    sees: "Success. No rows returned.",
    afterwards: "The two public forms keep working (they now go through our server). Open /book/<a coach id> and the gym QR form once to confirm. A signed-out visitor can no longer call those two database functions directly.",
    undo: `grant execute on function public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_gym_visitor_lead(uuid, uuid, text, text, text) to anon, authenticated;`,
    undoWhy: "Only if the public discovery-call page or the gym QR form stops working after step 17. Re-opens those two functions to the browser (the old way).",
    rows: [
      ["0271 is applied (the signed-out role cannot run book_session)", `not has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')`],
      ["the two functions exist", `${has.fnName("book_discovery_call")} and ${has.fnName("submit_gym_visitor_lead")}`],
      ["0272 is not already applied (the signed-out role can still run book_discovery_call)", `has_function_privilege('anon', 'public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text)', 'execute')`],
    ],
  },
  {
    n: "18",
    slug: "0276",
    title: "0276 a new direct message gives the recipient an in-app notice (one line per sender while unread, no message text)",
    migrations: ["0276"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. From now on a message to a coach or a client shows in their notification bell as '<name> sent you a message', one line per sender while it is unread. Send yourself a test message from a client and check the bell.",
    undo: `drop trigger if exists direct_messages_notify on public.direct_messages;
drop function if exists public.notify_on_direct_message();
delete from public.notifications where type = 'direct_message';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed'
  ));`,
    undoWhy: "Only if sending a message fails after step 18. Removes the notice trigger and the notices it wrote, and puts the notification type list back.",
    rows: [
      ["direct_messages and notifications exist", `${has.table("direct_messages")} and ${has.table("notifications")}`],
      ["0243 is applied (the notification type list includes email_changed)", `exists (select 1 from pg_constraint where conname = 'notifications_type_check' and pg_get_constraintdef(oid) like '%email_changed%')`],
      ["0276 is not already applied", `not exists (select 1 from pg_trigger where tgname = 'direct_messages_notify')`],
    ],
  },
  {
    n: "19",
    slug: "0277",
    title: "0277 a client's late cancel or late move is flagged for the coach to Charge or Waive (nothing is taken automatically)",
    migrations: ["0277"],
    sees: "Success. No rows returned.",
    afterwards: "A client cancelling or moving a session inside your cancellation window no longer loses a session by itself. You get a notice ('<name> cancelled a session inside the 24-hour window. Charge it or waive it.') and the item appears under Needs your decision on your dashboard with Charge and Waive buttons. Test with a throwaway client: schedule a session in a few hours, cancel it as the client, check the balance did not change and the notice arrived.",
    undo: `${fnFrom0248("cancel_booking_and_refund_credit")}

${fnFrom0248("reschedule_booking")}

drop function if exists public.resolve_late_change(uuid, boolean);
drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update on public.bookings
  for each row execute function public.audit_watch('credit_state', 'update_only', 'id');
delete from public.notifications where type = 'late_change';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message'
  ));`,
    undoWhy: "Only if cancelling or moving a booking breaks after step 19. Puts the two booking functions back to the previous version (late changes take a session by themselves again), removes the Charge/Waive function and the notices. The flag columns stay (harmless).",
    rows: [
      ["0248 is applied (the credit functions exist)", `${has.fnName("apply_session_credit_change")} and ${has.fnName("settle_booking_internal")} and ${has.col("bookings", "credit_state")}`],
      ["bookings, notifications and coach_booking_policies exist", `${has.table("bookings")} and ${has.table("notifications")} and ${has.table("coach_booking_policies")}`],
      ["0267 is applied (the audit function exists)", has.fnName("audit_watch")],
      ["0276 is applied (the notification type list includes direct_message)", `exists (select 1 from pg_constraint where conname = 'notifications_type_check' and pg_get_constraintdef(oid) like '%direct_message%')`],
      ["0277 is not already applied (the live cancel and reschedule functions are exactly the versions this step was built from)", `${md5Is("cancel_booking_and_refund_credit(uuid)", "b0485b9332f337b725669193b19f0887")} and ${md5Is("reschedule_booking(uuid, timestamptz, timestamptz)", "f45d1a198654ec4150e6ec958de3b1d1")}`],
    ],
  },
  {
    n: "20",
    slug: "0278",
    title: "0278 each coach picks how clients book: on their own, request and the coach confirms, or the coach schedules everyone (existing coaches start as 'coach schedules')",
    migrations: ["0278"],
    sees: "Success. No rows returned.",
    afterwards: "Every coach is set to 'I schedule everyone' until they choose: clients cannot book, start a weekly schedule or join a waiting list on their own. Open Availability and pick the mode (Ron: 'Clients request, I confirm' once step 21 is also applied; 'Clients book on their own' restores today's behaviour). You can always schedule any client. Test as a throwaway client: try to book (it must refuse); switch the mode to 'book on their own' and try again.",
    undo: `${fnFrom0248("book_session")}

${fnFrom0248("create_recurring_booking_series")}

${fnFrom0218("join_booking_waitlist")}

drop function if exists public.assert_client_may_book_directly(uuid, uuid, uuid);
drop function if exists public.coach_booking_mode(uuid);
drop function if exists public.coach_time_zone(uuid);
alter table public.coach_booking_policies drop column if exists booking_mode;`,
    undoWhy: "Only if booking a session breaks after step 20. Puts book_session, the weekly-schedule function and the waiting-list function back to the previous versions (clients can book themselves again) and removes the mode column and its three helper functions.",
    rows: [
      ["0248 is applied (book_session settles credits)", `${has.fnName("book_session")} and ${has.col("bookings", "credit_state")}`],
      ["coach_booking_policies exists", has.table("coach_booking_policies")],
      ["0278 is not already applied (the live book_session, weekly-schedule and waiting-list functions are exactly the versions this step was built from)", `${md5Is("book_session(uuid, uuid, uuid, timestamptz, timestamptz)", "da934a4629a0f09580619b7c908ab42a")} and ${md5Is("create_recurring_booking_series(uuid, uuid, uuid, timestamptz, integer, integer)", "a14562f9889b8094e99a5403e5423835")} and ${md5Is("join_booking_waitlist(uuid, uuid, uuid, timestamptz, timestamptz)", "f2d3243ac4fcf1876d894178e8a937f7")}`],
    ],
  },
  {
    n: "21",
    slug: "0279",
    title: "0279 booking requests: in 'request' mode a client asks for a new session or to move one, and the coach confirms (nothing is booked or held until then)",
    migrations: ["0279"],
    sees: "Success. No rows returned.",
    afterwards: "In 'Clients request, I confirm' mode a client picks a time and sends a request (nothing is booked or held); you get a notice and a Confirm / Decline row under Needs your decision; Confirm books it (or moves the session, flagging a late move for Charge or Waive); the client is told either way. Requests whose time passes lapse by themselves. Direct moves are refused unless the mode is 'book on their own'. Test with a throwaway client in request mode.",
    undo: `${fnFrom0277("reschedule_booking")}

drop function if exists public.expire_stale_booking_requests();
drop function if exists public.cancel_booking_request(uuid);
drop function if exists public.resolve_booking_request(uuid, boolean);
drop function if exists public.request_booking_move(uuid, timestamptz, timestamptz);
drop function if exists public.request_booking(uuid, uuid, uuid, timestamptz, timestamptz);
drop function if exists public.check_booking_request_slot(uuid, uuid, timestamptz, timestamptz);
drop function if exists public.coach_time_is_open(uuid, timestamptz, timestamptz);
drop table if exists public.booking_requests;
delete from public.notifications where type in ('booking_request', 'request_decision');
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message', 'late_change'
  ));`,
    undoWhy: "Only if moving or requesting a session breaks after step 21. Puts reschedule_booking back to the step 19 version, removes the request functions, the request table (pending requests are lost) and their notices, and puts the notification type list back to the step 19 list (late_change stays).",
    rows: [
      ["0277 is applied (late-change flags exist)", has.col("bookings", "late_charge_state")],
      ["0278 is applied (the booking mode exists)", `${has.col("coach_booking_policies", "booking_mode")} and ${has.fnName("coach_booking_mode")}`],
      ["coach_availability_windows, coach_availability_exceptions and discovery_bookings exist", `${has.table("coach_availability_windows")} and ${has.table("coach_availability_exceptions")} and ${has.table("discovery_bookings")}`],
      ["is_org_admin_of_group and offer_freed_slot_to_waitlist exist", `${has.fnName("is_org_admin_of_group")} and ${has.fnName("offer_freed_slot_to_waitlist")}`],
      ["0279 is not already applied (the live reschedule_booking is exactly the step 19 version, and there is no request table yet)", `${md5Is("reschedule_booking(uuid, timestamptz, timestamptz)", "1283df1e48a57927374db97199ad00eb")} and ${has.noTable("booking_requests")}`],
    ],
  },
  {
    n: "22",
    slug: "0280",
    title: "0280 credit expiry kept human: a coach can hold expiry for one client, give back sessions that expired (up to what expired, logged, undoable), and sets how early they are prompted",
    migrations: ["0280"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. After the code deploy: under Needs your decision a client whose sessions expire within 30 days gets a one-line check-in (Message them, Extend or pause expiry, Not now); a returning client whose sessions already expired gets a Reinstate prompt. Nothing is extended, reinstated or sent automatically. The nightly expiry job skips a client whose expiry you hold.",
    undo: `do $undo$
begin
  if exists (select 1 from public.session_credits where expiry_hold_until > now()) then
    raise exception 'Some clients still have expiry on hold. Removing step 22 now would let their sessions expire at the next nightly run. Clear those holds first, or leave step 22 in place. Nothing was changed.';
  end if;
end
$undo$;
drop function if exists public.undo_expired_reinstatement(uuid, uuid, integer);
drop function if exists public.reinstate_expired_credits(uuid, uuid, integer, text);
drop function if exists public.set_credit_expiry_hold(uuid, uuid, timestamptz, text);
drop function if exists public.reinstatable_expired_credits(uuid, uuid);
drop trigger if exists session_credits_audit on public.session_credits;
create trigger session_credits_audit after insert or update on public.session_credits
  for each row execute function public.audit_watch('balance,payment_hold', 'insert_too', 'athlete_id,group_id');
alter table public.coach_booking_policies drop column if exists expiry_heads_up_days;
alter table public.session_credits drop column if exists expiry_hold_until;`,
    undoWhy: "Only if something about session balances or the expiry job misbehaves after step 22. It refuses (changes nothing) while any client still has expiry on hold, because removing the hold column would let their sessions expire at the next nightly run: clear the holds first. Otherwise it removes the three override functions, the helper, and the two new columns, and puts the audit trigger back. The give-back record table (session_credit_reinstatements) is KEPT on purpose, so applying step 22 again later can never let the same expired sessions be given back twice (reinstated sessions stay on balances and in the ledger).",
    rows: [
      ["0209 is applied (credit expiry exists)", `${has.col("coach_booking_policies", "credit_expiry_days")} and ${has.col("session_credits", "last_granted_at")}`],
      ["0246 and 0248 are applied (the ledger and the internal credit function exist)", `${has.table("session_credit_ledger")} and ${has.fnName("apply_session_credit_change")}`],
      ["0267 is applied (the audit trail and its session balance trigger exist)", `${has.fnName("audit_watch")} and exists (select 1 from pg_trigger where tgname = 'session_credits_audit')`],
      ["is_org_admin_of_group exists", has.fnName("is_org_admin_of_group")],
      ["0280 is not already applied (the expiry hold column is not there yet)", has.noCol("session_credits", "expiry_hold_until")],
    ],
  },
  {
    n: "23",
    slug: "0281",
    title: "0281 inactive clients: a coach can set a client aside as inactive (reversible, nothing deleted, coach-only), and a workout, session or message from the client brings them back",
    migrations: ["0281"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. After the code deploy: under Needs your decision a client who has been quiet for about four months with a few other signs gets a neutral card (Send a door-open note, Set aside as inactive, Keep active, Not now), and a client profile gets a Set aside / Bring back control. A set-aside client is hidden from your dashboard and quiet-client alerts; their history, balance and messages stay. Only you (their coach or an org owner or admin) can see that someone is set aside, never the client or their teammates. Nothing is archived or sent automatically.",
    undo: `drop trigger if exists direct_messages_resurface_client on public.direct_messages;
drop trigger if exists bookings_resurface_client on public.bookings;
drop trigger if exists workout_logs_resurface_client on public.workout_logs;
drop function if exists public.resurface_inactive_client();
drop function if exists public.set_client_inactive(uuid, uuid, boolean, text);
drop table if exists public.client_inactive;
drop table if exists public.client_inactive_events;`,
    undoWhy: "Only if set-aside clients or the new triggers misbehave after step 23. Removes the three triggers, the two functions, the coach-only set-aside table and its event log. Anyone currently set aside simply shows as active again (nothing else about them changes).",
    rows: [
      ["group_memberships, workout_logs, bookings and direct_messages exist", `${has.table("group_memberships")} and ${has.table("workout_logs")} and ${has.table("bookings")} and ${has.table("direct_messages")}`],
      ["is_org_admin_of_group exists", has.fnName("is_org_admin_of_group")],
      ["0281 is not already applied (the set-aside table is not there yet)", has.noTable("client_inactive")],
    ],
  },
  {
    n: "24",
    slug: "0282",
    title: "0282 URGENT: close again the internal server-only functions that step 13 (0271) opened to every signed-in account (credit changes, booking settlement, audit writers, SMS and rate-limit bookkeeping, AI metering)",
    migrations: ["0282"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes: the app only ever calls these from the server, and the functions people use (book, cancel, finish a workout, give back sessions and the rest) call them as the database owner. Afterwards run check-function-acl.sql: every row must say ok = true.",
    undo: functionAclUndoSql(),
    undoWhy: "Only if something that used to work for a signed-in person stops working after step 24 (it should not: the app calls these only from the server). It gives the signed-in role access to these functions again, which is the OPEN state step 13 left, so run it only to diagnose and tell Spot straight away.",
    rows: [
      ["the internal functions exist", `${has.fnName("apply_session_credit_change")} and ${has.fnName("settle_booking_internal")} and ${has.fnName("audit_record")} and ${has.fnName("reserve_ai_call")} and ${has.fnName("adjust_coach_credits")}`],
      ["0282 is not already applied (a signed-in user can still run apply_session_credit_change)", "has_function_privilege('authenticated', 'public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid)', 'execute')"],
    ],
  },
  {
    n: "25",
    slug: "0283",
    title: "0283 session length separate from the slot step: a window can keep 60-minute slots with 55-minute sessions (a 5-minute gap), or any length up to the step",
    migrations: ["0283"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone at once: every existing window has no session length, which means the same as its slot step. After the code deploy, on the Availability page: pick a Session length for all your hours (30, 40, 45, 50, 55, 60 or your own), or set it per window. Slots keep starting every slot step; each booking lasts the session length. For 06:00 to 06:55 then 07:00 to 07:55: windows with a slot every 60 minutes, session length 55, and a buffer of 5 or less under Booking rules.",
    undo: `alter table public.coach_availability_windows drop constraint if exists coach_availability_windows_session_minutes_range;
alter table public.coach_availability_windows drop column if exists session_minutes;`,
    undoWhy: "Only if something about booking times misbehaves after step 25. Removes the session length (every window goes back to sessions as long as the slot step; bookings already made keep their own times).",
    rows: [
      ["coach_availability_windows exists", has.table("coach_availability_windows")],
      ["0283 is not already applied (the session length column is not there yet)", has.noCol("coach_availability_windows", "session_minutes")],
    ],
  },
  {
    n: "26",
    slug: "move-home-team",
    title: "move the group The Home Team from Ron's own organization (Enduring Strength Co.) into Coast2Coast Fitness, keeping its programs, history and Ron's coach access",
    migrations: [],
    warn: "Platform-owner change, one group only. Run the precheck first (every row true). Nothing is deleted. The group keeps its two programs and everything attached to it; only which organization it belongs to changes.",
    sees: "Success. No rows returned.",
    afterwards: "The Home Team now belongs to Coast2Coast Fitness: it appears under that organization in the business-name menu and no longer under Enduring Strength Co. Ron stays a coach of the group (a normal group membership) and the owner of Coast2Coast Fitness, so he keeps full programming access. The group's programs, workouts and history are unchanged.",
    bodySql: "-- The Home Team (group 060017b5-e613-4204-a101-c6a14c3a9630) moves from Enduring Strength Co. (b7318b19-a17e-4412-88f1-51d68fcf026f) to Coast2Coast Fitness (e369f4a7-c53a-4532-95d3-f7bd14e40e48).\n-- groups.organization_id is the only organization link the group's own data hangs on: its programs, workouts, sessions, invites and memberships are keyed\n-- to the GROUP, not to the organization, so they come with it. Organization-wide settings (branding, billing, tags) are the new organization's from now on.\ndo $move$\ndeclare\n  n int;\nbegin\n  update public.groups set organization_id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48' where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f';\n  get diagnostics n = row_count;\n  if n <> 1 then\n    raise exception 'The Home Team was not found in Enduring Strength Co., so nothing was moved.';\n  end if;\n  -- Every coach of the group is a member of the new organization (Ron already owns it, so this adds nobody today).\n  insert into public.organization_memberships (organization_id, profile_id, role)\n  select 'e369f4a7-c53a-4532-95d3-f7bd14e40e48', gm.profile_id, 'coach' from public.group_memberships gm\n  where gm.group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and gm.role = 'coach'\n  on conflict (organization_id, profile_id) do nothing;\nend\n$move$;",
    undo: "update public.groups set organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f' where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48';",
    undoWhy: "Only if the move turns out to be wrong. Puts The Home Team back into Enduring Strength Co. (memberships added to Coast2Coast Fitness stay; they change nothing).",
    rows: [
      ["the group The Home Team exists", "exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630')"],
      ["Coast2Coast Fitness exists", "exists (select 1 from public.organizations where id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48')"],
      ["step 26 is not already applied (The Home Team is still in Enduring Strength Co.)", "exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f')"],
      ["The Home Team has no clients, only coaches (so no client data is tied to the old organization)", "not exists (select 1 from public.group_memberships where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and role = 'athlete')"],
      ["every coach of The Home Team already owns or administers Coast2Coast Fitness", "not exists (select 1 from public.group_memberships gm where gm.group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and gm.role = 'coach' and not exists (select 1 from public.organization_memberships om where om.organization_id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48' and om.profile_id = gm.profile_id and om.role in ('owner', 'admin')))"],
    ],
  },
  {
    n: "27",
    slug: "0284",
    title: "0284 a coach can propose a goal to a client, and the client confirms it, changes it or declines it (a coach cannot confirm it for them)",
    migrations: ["0284"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. After the code deploy: on a client's profile a coach can suggest a goal; the client sees it on My Goal with Looks right, Change it and Not now, and the coach is told how they answered. A goal a client proposes still waits for the coach exactly as before.",
    undo: "drop trigger if exists client_goals_notify on public.client_goals;\ndrop trigger if exists client_goals_guard_update on public.client_goals;\ndrop function if exists public.notify_on_client_goal();\ndrop function if exists public.guard_client_goal_update();\ndrop policy if exists \"client_goals_update_athlete_answers\" on public.client_goals;\ndrop policy if exists \"client_goals_insert_coach\" on public.client_goals;\ndelete from public.notifications where type in ('goal_proposed', 'goal_answered');\nalter table public.notifications drop constraint if exists notifications_type_check;\nalter table public.notifications add constraint notifications_type_check\n  check (type in (\n    'comment', 'program_assigned', 'macros_assigned', 'partner_request',\n    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',\n    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',\n    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',\n    'email_changed', 'direct_message', 'late_change', 'booking_request', 'request_decision'\n  ));",
    undoWhy: "Only if goals misbehave after step 27. Removes the coach-proposal and client-answer rules and the two notice types (any such notices are deleted). A goal a coach already suggested stays as it is; after the undo only a coach can confirm goals again.",
    rows: [
      ["client_goals and the notification type list exist", `${has.table("client_goals")} and exists (select 1 from pg_constraint where conname = 'notifications_type_check')`],
      ["is_group_coach exists", has.fnName("is_group_coach")],
      ["0284 is not already applied (the coach proposal rule is not there yet)", has.noPolicy("client_goals", "client_goals_insert_coach")],
    ],
  },
  {
    n: "28",
    slug: "0285",
    title: "0285 a record of the rest-day nudges sent, so they can be limited to 2 in any 7 days and stopped after 3 with no response",
    migrations: ["0285"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. After the code deploy the nightly rest-day nudge sends at most 2 in any 7 days, stops after 3 in a row that got no response (and starts again the next time the client does something), and names the client's own goal when they have one. Until this step is applied the nightly job sends no rest-day nudges at all.",
    undo: "drop table if exists public.rest_day_nudges;",
    undoWhy: "Only if the record misbehaves after step 28. Removes the record of sent nudges; the nightly job then sends no rest-day nudges until the table is back.",
    rows: [
      ["profiles and groups exist", `${has.table("profiles")} and ${has.table("groups")}`],
      ["0285 is not already applied (the nudge record is not there yet)", has.noTable("rest_day_nudges")],
    ],
  },
  {
    n: "29",
    slug: "0286",
    title: "0286 favorite foods: a client can star a food they logged and log it again in one tap (extends recipe_favorites; private to the client; macros frozen as starred)",
    migrations: ["0286"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once. After the code deploy: in the nutrition log a client can save any logged food (or a planned meal after Ate it) as a favorite, and a Favorites row of one-tap chips shows when they log something else. Favorites are private: a coach never sees them, and starring or logging from one tells nobody anything. The old recipe hearts are untouched and are not shown as favorite foods.",
    undo: "drop trigger if exists recipe_favorites_limit_food on public.recipe_favorites;\ndrop function if exists public.limit_food_favorites();\ndelete from public.recipe_favorites where kind = 'food';\ndrop index if exists public.recipe_favorites_food_idx;\nalter table public.recipe_favorites drop constraint if exists recipe_favorites_food_snapshot;\nalter table public.recipe_favorites drop constraint if exists recipe_favorites_kind_check;\nalter table public.recipe_favorites drop column if exists fat_g;\nalter table public.recipe_favorites drop column if exists carbs_g;\nalter table public.recipe_favorites drop column if exists protein_g;\nalter table public.recipe_favorites drop column if exists calories;\nalter table public.recipe_favorites drop column if exists label;\nalter table public.recipe_favorites drop column if exists kind;",
    undoWhy: "Only if favorites misbehave after step 29. Removes the favorite foods (the starred foods are deleted; logged entries are not touched) and the added columns. The old recipe hearts stay.",
    rows: [
      ["recipe_favorites exists", has.table("recipe_favorites")],
      ["0286 is not already applied (the favorite kind column is not there yet)", has.noCol("recipe_favorites", "kind")],
    ],
  },
  {
    n: "30",
    slug: "copy-main-group-program",
    title: "copy the program christmas_abs_program from Main Group into The Home Team (nothing is deleted; run check-copy-result.sql afterwards and look at it before step 31)",
    migrations: [],
    warn: "Run AFTER step 26 (The Home Team moved into Coast2Coast Fitness). The original program is not touched. Afterwards run check-copy-result.sql: it shows the original and the copy side by side.",
    sees: "Success. No rows returned.",
    afterwards: "The Home Team has a third program, christmas_abs_program, an exact copy (same weeks, workouts, exercises, sets, notes and progressions) of the one in Main Group. Run check-copy-result.sql to see the counts side by side.",
    bodySql: "-- Copies the program christmas_abs_program (66 workouts, in Main Group) into The Home Team with the app's own all-or-nothing copy function (duplicate_program: every week,\n-- workout, exercise, set, note and progression, in one go). The original is not touched. Then it checks the copy has exactly the same number of workouts,\n-- exercises and sets, and stops (nothing is kept) if not.\ndo $copy$\ndeclare\n  v_new uuid;\n  a int; b int; c int; d int; e int; f int;\nbegin\n  if exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program') then\n    raise exception 'The Home Team already has a program with that name, so nothing was copied.';\n  end if;\n  v_new := public.duplicate_program('5b8a8a3a-344d-4192-a892-f74494fff9ab', '060017b5-e613-4204-a101-c6a14c3a9630', '136394ed-f108-4283-bcb7-310a1ac6cbc8', null, null, null);\n  select count(*) into a from public.workouts where program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';\n  select count(*) into b from public.workouts where program_id = v_new;\n  select count(*) into c from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';\n  select count(*) into d from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = v_new;\n  select count(*) into e from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';\n  select count(*) into f from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = v_new;\n  if a <> b or c <> d or e <> f or a = 0 then\n    raise exception 'The copy does not match the original (workouts % vs %, exercises % vs %, sets % vs %), so nothing was kept.', a, b, c, d, e, f;\n  end if;\nend\n$copy$;",
    undo: "delete from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program';",
    undoWhy: "Only if the copy is wrong. Removes the copy in The Home Team (the original in Main Group is untouched).",
    rows: [["the program christmas_abs_program exists in Main Group","exists (select 1 from public.programs where id = '5b8a8a3a-344d-4192-a892-f74494fff9ab' and group_id = 'b292055b-edc6-4171-ad2b-a89d65dcd8db')"],["The Home Team exists","exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630')"],["step 30 is not already applied (The Home Team has no copy yet)","not exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program')"],["duplicate_program exists","to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null"]].map(([n, e]) => [n, e]),
  },
  {
    n: "31",
    slug: "delete-two-groups",
    title: "delete Main Group and the stray Coast to Coast group (only after the copy is checked); everything in them is first saved in cleanup_backups",
    migrations: [],
    warn: "DELETES two groups. Run steps 26 and 30 first and check the copy. It refuses by itself if either group has a client, a logged workout, a booking, a session record, a purchase or a balance, or if the copy is missing or does not match.",
    sees: "Success. No rows returned.",
    afterwards: "Main Group (in Coast2Coast Fitness) and the stray Coast to Coast group (in Enduring Strength Co.) are gone. Their programs, workouts and members were saved as one record in cleanup_backups first. The copy of christmas_abs_program lives on in The Home Team.",
    bodySql: "-- Deletes the two groups Ron chose to remove: Main Group (Coast2Coast Fitness, its program is now copied into The Home Team) and the stray \"Coast to Coast\"\n-- group (Enduring Strength Co., an unused 4-week program). It refuses, and nothing is deleted, if either group has a client, a logged workout, a booking, a\n-- session record, a purchase or a session balance, or if the copy in The Home Team is missing or does not match. Before deleting it saves everything in both\n-- groups (the groups, programs, workouts, exercises, sets, notes, progressions, memberships, wellness check-ins, view state and Spotter dismissals) as one record in cleanup_backups, so it can be restored by hand.\ncreate table if not exists public.cleanup_backups (\n  id uuid primary key default uuid_generate_v4(),\n  taken_at timestamptz not null default now(),\n  label text not null,\n  payload jsonb not null\n);\nalter table public.cleanup_backups enable row level security;\nrevoke all on public.cleanup_backups from public, anon, authenticated;\ndo $del$\ndeclare\n  g uuid[] := array['b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182']::uuid[];\n  copy_id uuid;\n  a int; b int; c int; d int; e int; f int;\nbegin\n  if exists (select 1 from public.group_memberships where group_id = any (g) and role = 'athlete') then raise exception 'One of the groups has a client, so nothing was deleted.'; end if;\n  if exists (select 1 from public.workout_logs where group_id = any (g)) then raise exception 'One of the groups has a logged workout, so nothing was deleted.'; end if;\n  if exists (select 1 from public.bookings where group_id = any (g)) then raise exception 'One of the groups has a booking, so nothing was deleted.'; end if;\n  if exists (select 1 from public.athlete_sessions where group_id = any (g)) then raise exception 'One of the groups has a session record, so nothing was deleted.'; end if;\n  if exists (select 1 from public.credit_purchases where group_id = any (g)) then raise exception 'One of the groups has a purchase, so nothing was deleted.'; end if;\n  if exists (select 1 from public.session_credits where group_id = any (g)) then raise exception 'One of the groups has a session balance, so nothing was deleted.'; end if;\n  select id into copy_id from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program' order by created_at desc limit 1;\n  if copy_id is null then raise exception 'The copy of the program in The Home Team is missing, so nothing was deleted. Run the copy step first.'; end if;\n  select count(*) into a from public.workouts where program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';\n  select count(*) into b from public.workouts where program_id = copy_id;\n  select count(*) into c from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';\n  select count(*) into d from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = copy_id;\n  select count(*) into e from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';\n  select count(*) into f from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = copy_id;\n  if a <> b or c <> d or e <> f or a = 0 then raise exception 'The copy does not match the original, so nothing was deleted.'; end if;\n\n  insert into public.cleanup_backups (label, payload)\n  select 'delete Main Group and the stray Coast to Coast group, 2026-10-06', jsonb_build_object(\n    'groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.groups x where x.id = any (g)),\n    'memberships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.group_memberships x where x.group_id = any (g)),\n    'programs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.programs x where x.group_id = any (g)),\n    'progressions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.exercise_progressions x where x.group_id = any (g)),\n    'workouts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.workouts x where x.group_id = any (g)),\n    'exercises', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.group_workout_exercises x where x.group_id = any (g)),\n    'sets', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.group_workout_exercise_sets s where s.group_workout_exercise_id in (select id from public.group_workout_exercises where group_id = any (g))),\n    'notes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.workout_notes x where x.group_id = any (g)),\n    'wellness_checkins', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.wellness_checkins x where x.group_id = any (g)),\n    'coach_view_state', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.coach_view_state x where x.group_id = any (g)),\n    'programming_spotter_dismissals', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.programming_spotter_dismissals x where x.program_id in (select id from public.programs where group_id = any (g)))\n  );\n\n  delete from public.groups where id = any (g);\nend\n$del$;",
    undo: "select id, taken_at, label, jsonb_object_keys(payload) as saved from public.cleanup_backups order by taken_at desc;",
    undoWhy: "A deleted group cannot be put back by a button. This lists what was saved in cleanup_backups so it can be restored by hand: every group, program, workout, exercise, set, note, progression, membership, wellness check-in, view-state row and Spotter dismissal of both groups is in the payload. To put it all back in one go run restore-step31-from-backup.sql (it restores the most recent backup and refuses if either group already exists).",
    rows: [["both groups exist","(select count(*) from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) = 2"],["the copy of christmas_abs_program is in The Home Team","exists (select 1 from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program')"],["neither group has a client","not exists (select 1 from public.group_memberships where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182') and role = 'athlete')"],["neither group has a logged workout, a booking or a session record","not exists (select 1 from public.workout_logs where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) and not exists (select 1 from public.bookings where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) and not exists (select 1 from public.athlete_sessions where group_id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182'))"],["step 31 is not already applied (both groups are still there)","(select count(*) from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) = 2"]].map(([n, e]) => [n, e]),
  },
  {
    n: "32",
    slug: "0287",
    title: "0287 a session can be longer than the time between slot starts (a start every 15 minutes with a 55-minute session); the session still has to fit inside its window",
    migrations: ["0287"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once and no existing hours change. After the code deploy a coach can set Slot every 15 (or 5, 10, 20, 30) minutes together with a session length of 55 or 60: starts overlap, and booking one blocks the others it overlaps. Run this after step 25.",
    undo: "-- Puts the old rule back (a session no longer than the step). A window set up under the new rule (a session longer than its step) is first made the same as its step, so the old rule can be applied.\nupdate public.coach_availability_windows set session_minutes = slot_duration_minutes where session_minutes is not null and session_minutes > slot_duration_minutes;\nalter table public.coach_availability_windows drop constraint if exists coach_availability_windows_session_minutes_range;\nalter table public.coach_availability_windows add constraint coach_availability_windows_session_minutes_range check (session_minutes is null or (session_minutes between 5 and 480 and session_minutes <= slot_duration_minutes));",
    undoWhy: "Only if overlapping starts misbehave. Restores the 0283 rule (a session no longer than the step). Any window with a session longer than its step is changed to a session the same as its step first; nothing else is touched.",
    rows: [
      ["coach_availability_windows has the session length column (step 25 / 0283 is applied)", has.col("coach_availability_windows", "session_minutes")],
      ["0287 is not already applied (the old rule, a session no longer than the step, is still the rule)", "exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) like '%slot_duration_minutes%')"],
      ["no window already has hours where the end is not after the start", "not exists (select 1 from public.coach_availability_windows where end_time <= start_time)"],
    ],
  },
  {
    n: "33",
    slug: "0288",
    title: "0288 two bookings that overlap at different minutes can no longer both be saved at the same instant (a lock per coach, then a second overlap check before a confirmed future booking is saved or moved)",
    migrations: ["0288"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. A booking, a confirmed request, a weekly schedule or the public discovery form that would overlap another session (with your gap) is refused with the usual 'that slot was just taken', even if two arrive at the same moment. History is never re-checked. Run this after step 32.",
    undo: "drop trigger if exists bookings_guard_overlap on public.bookings;\ndrop trigger if exists discovery_bookings_guard_overlap on public.discovery_bookings;\ndrop function if exists public.guard_booking_overlap();",
    undoWhy: "Only if bookings misbehave after step 33. Removes the extra overlap check and its lock; the booking functions' own overlap checks stay.",
    rows: [
      ["bookings and discovery_bookings exist", `${has.table("bookings")} and ${has.table("discovery_bookings")}`],
      ["0288 is not already applied (the overlap guard is not there yet)", "not exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap')"],
    ],
  },
  {
    n: "34",
    slug: "0289",
    title: "0289 a window of hours can be tagged with one of your session types (Online, In person, Weight room, Practice, Game...), and a booking made inside it is tagged the same",
    migrations: ["0289"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes at once and no existing window changes (no tag means any type). After the code deploy: on Availability each window has an optional 'Session type', sessions booked inside a tagged window carry that type (shown on the calendar day), and Business > Session types offers one-tap Online / In person or Weight room / Practice / Game. The type never changes what a session costs. Run after step 33.",
    undo: "drop trigger if exists bookings_tag_session_type on public.bookings;\ndrop function if exists public.tag_booking_session_type();\ndrop trigger if exists coach_availability_windows_guard_type on public.coach_availability_windows;\ndrop function if exists public.guard_window_session_type();\ndrop index if exists public.coach_availability_windows_session_type_id_idx;\nalter table public.coach_availability_windows drop column if exists session_type_id;",
    undoWhy: "Only if tagging misbehaves after step 34. Removes the window tag column (the tags on windows are lost) and the automatic tagging of new bookings. Types already on bookings stay.",
    rows: [
      ["coach_availability_windows and session_types exist", `${has.table("coach_availability_windows")} and ${has.table("session_types")}`],
      ["bookings has the session type column (0261 is applied)", has.col("bookings", "session_type_id")],
      ["0289 is not already applied (the window tag column is not there yet)", has.noCol("coach_availability_windows", "session_type_id")],
    ],
  },
  {
    n: "35",
    slug: "0290",
    title: "0290 four database closures: a membership can no longer be handed to another person, the two AI-credit spending functions are server-only and refuse negative amounts, two private video buckets are readable only by the person they belong to and the coaches, and a client who joined by invite link is marked as signed in",
    migrations: ["0290"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. A coach can no longer swap the person on an existing membership; the AI routes (deployed in the same release) charge credits from the server with the server's own numbers; an athlete's form-check video and a coach's video check-in can be opened only by that person and the group's coaches; clients who joined by invite link and have signed in stop showing 'Not signed in yet' and can no longer be given a coach-made login link. Deploy the release right after this paste: until the new code is live, charging AI credits fails with 'Couldn't process credits' (the AI is down today anyway).",
    undo: [
      "drop trigger if exists group_memberships_guard_identity on public.group_memberships;",
      "drop function if exists public.guard_membership_identity();",
      fnFromMigration("0220", "spend_coach_credits"),
      "grant execute on function public.spend_coach_credits(uuid, integer) to authenticated, service_role;",
      fnFromMigration("0250", "spend_ai_action"),
      "grant execute on function public.spend_ai_action(uuid, text, integer, integer) to authenticated, service_role;",
      'drop policy if exists "athlete_exercise_videos_select_own_or_coach" on storage.objects;',
      'drop policy if exists "athlete_exercise_videos_select_members" on storage.objects;',
      "create policy \"athlete_exercise_videos_select_members\" on storage.objects for select to authenticated using (bucket_id = 'athlete-exercise-videos' and public.is_group_member(((storage.foldername(name))[1])::uuid));",
      'drop policy if exists "coach_video_checkins_select_recipient_or_coach" on storage.objects;',
      'drop policy if exists "coach_video_checkins_select_members" on storage.objects;',
      "create policy \"coach_video_checkins_select_members\" on storage.objects for select to authenticated using (bucket_id = 'coach-video-checkins' and public.is_group_member(((storage.foldername(name))[1])::uuid));",
      fnFromMigration("0267", "guard_profile_sensitive_columns"),
    ].join("\n"),
    undoWhy: "Only if something misbehaves after step 35. Puts back the old functions, grants and the two wider video policies. It does NOT un-stamp the people who were marked as signed in (that was a correction of wrong data).",
    rows: [
      ["group_memberships, coach_credits and session_exercise_videos exist", `${has.table("group_memberships")} and ${has.table("coach_credits")} and ${has.table("session_exercise_videos")}`],
      ["spend_ai_action, spend_coach_credits, audit_blocked exist", `${has.fnName("spend_ai_action")} and ${has.fnName("spend_coach_credits")} and ${has.fnName("audit_blocked")}`],
      ["0290 is not already applied (the membership identity guard is not there yet)", "not exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_identity')"],
    ],
  },
  {
    n: "36",
    slug: "0291",
    title: "0291 booking and credit closures: a booking, a waiting-list place or a weekly schedule must name a coach who coaches that group, a client cannot cancel or move a session that has already started or been marked attended, and the nightly credit expiry becomes one locked step that takes only an amount",
    migrations: ["0291"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. A coach can no longer put a booking on another coach's calendar, and a client can no longer spend one group's credit on another coach's calendar. A client who tries to cancel or move a session that has started (or that the coach marked attended) is told to ask their coach; cancelling or moving a future session works as before and a coach is never refused. The nightly expiry (code in the same release) now takes off only what is truly unused (sessions booked ahead or not yet marked are kept) and does it in one locked step; until the new code is live the old job still runs as before. Run after step 35.",
    undo: [
      fnFromMigration("0278", "book_session"),
      fnFromMigration("0278", "join_booking_waitlist"),
      fnFromMigration("0278", "create_recurring_booking_series"),
      fnFromMigration("0277", "cancel_booking_and_refund_credit"),
      fnFromMigration("0279", "reschedule_booking"),
      "drop function if exists public.expire_session_credit_balance(uuid, uuid, integer, integer);",
    ].join("\n"),
    undoWhy: "Only if booking misbehaves after step 36. Puts the five booking functions back as they were (without the coach-belongs-to-group check and the started-session guard) and removes the atomic credit-expiry function (the nightly job then expires nothing until it is back).",
    rows: [
      ["assert_client_may_book_directly exists (0278 is applied)", has.fnName("assert_client_may_book_directly")],
      ["bookings, recurring_booking_series and booking_waitlist_entries exist", `${has.table("bookings")} and ${has.table("recurring_booking_series")} and ${has.table("booking_waitlist_entries")}`],
      ["the credit functions and expiry record exist (0248 and the expiry table are applied)", `${has.fnName("apply_session_credit_change")} and ${has.table("session_credit_expirations")}`],
      ["0291 is not already applied (book_session does not check the coach yet)", `coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace), false)`],
    ],
  },
  {
    n: "37",
    slug: "0292",
    title: "0292 the AI call log records why a call failed (a short error class), so an AI outage can be diagnosed",
    migrations: ["0292"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. After the code deploy every failed AI call records a short class (key rejected, credit or spend limit, rate limit, overloaded, timeout, bad request, unknown) and the nightly AI jobs show as failed when every item failed. Run after step 36.",
    undo: "alter table public.ai_usage_log drop constraint if exists ai_usage_log_error_class_len;\nalter table public.ai_usage_log drop column if exists error_class;",
    undoWhy: "Only if the new column causes trouble. Removes the column (the recorded classes are lost).",
    rows: [
      ["ai_usage_log exists", has.table("ai_usage_log")],
      ["0292 is not already applied (the error_class column is not there yet)", has.noCol("ai_usage_log", "error_class")],
    ],
  },
  {
    n: "38",
    slug: "0293",
    title: "0293 a signed-in coach can no longer refund their own meal-plan or program charge by claiming the generation failed: that refund becomes server-only, and the coach's own 'This was wrong' button keeps working",
    migrations: ["0293"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. The coach's 'This was wrong' button still refunds the latest charge once. The automatic refund when an AI meal-plan generation delivered nothing is now decided by the server (code in the same release): until that code is live the old browser call is refused, so a failed generation is not auto-refunded. Run it together with the release's code deploy.",
    undo: [fnFromMigration("0245", "refund_coach_credit"), "drop function if exists public.refund_coach_credit_for(uuid, text, text, text, text, uuid);"].join(String.fromCharCode(10)),
    undoWhy: "Only if refunds misbehave after step 38. Puts refund_coach_credit back as it was (the browser can name either trigger again, which re-opens the self-refund) and removes the server-only refund function.",
    rows: [
      ["ai_charges, ai_output_refunds and coach_credits exist (0245 is applied)", `${has.table("ai_charges")} and ${has.table("ai_output_refunds")} and ${has.table("coach_credits")}`],
      ["refund_coach_credit exists", has.fn("refund_coach_credit(text, text, text, text)")],
      ["0293 is not already applied (the server-only refund function is not there yet)", `not ${has.fnName("refund_coach_credit_for")}`],
    ],
  },
  {
    n: "39",
    slug: "0294",
    title: "0294 food preferences and allergy safety: one preferences row per client (allergies, dislikes, diet type, protein target and floor) that the client edits for their tastes and a coach edits for the rules, a fixed-wording notice to the coaches when allergies or dislikes change, the client's answer to 'are you happy with your meal plan', and three new notification types added to the list the database already has",
    migrations: ["0294"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: a client sees 'My food preferences' on their Nutrition tab and a coach sees Preferences in the client's Nutrition area; a meal option that names an allergen or a food the client does not eat is never offered and is hidden from the client if it was assigned before; a change to allergies or dislikes sends the client's coaches one short notice, and a change to a client's allergies or intolerances by someone else sends the client one. No existing data changes and no existing function is replaced. Run it together with the release's code deploy.",
    undo: [
      "do $undo$ declare v_def text; v_have text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; delete from public.notifications where type in ('nutrition_preferences_changed', 'nutrition_prompt_answered', 'nutrition_allergies_updated'); select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m; v_have := array(select t from unnest(v_have) as t where t not in ('nutrition_preferences_changed', 'nutrition_prompt_answered', 'nutrition_allergies_updated')); alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_have) as t)); end $undo$;",
      "drop trigger if exists client_nutrition_feedback_notify on public.client_nutrition_feedback;",
      "drop trigger if exists client_nutrition_feedback_guard on public.client_nutrition_feedback;",
      "drop trigger if exists client_nutrition_preferences_notify on public.client_nutrition_preferences;",
      "drop trigger if exists client_nutrition_preferences_guard on public.client_nutrition_preferences;",
      "drop table if exists public.client_nutrition_feedback;",
      "drop table if exists public.client_nutrition_preferences;",
      "drop function if exists public.notify_on_nutrition_feedback();",
      "drop function if exists public.guard_client_nutrition_feedback();",
      "drop function if exists public.notify_on_nutrition_preferences();",
      "drop function if exists public.guard_client_nutrition_preferences();",
      "drop function if exists public.nutrition_allergies_ok(text[]);",
      "drop function if exists public.nutrition_list_ok(text[], int, int);",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if food preferences misbehave after step 39. Removes the two tables (every saved preference and answer is lost), their triggers and helper functions, deletes the three new kinds of notification, and puts the notification types back to the list the database had without them (read from the live list, so another release's types are kept). Nothing else is touched.",
    rows: [
      ["profiles, groups, group_memberships and notifications exist", `${has.table("profiles")} and ${has.table("groups")} and ${has.table("group_memberships")} and ${has.table("notifications")}`],
      ["is_coach_of_athlete and is_group_coach exist (the new row security uses them)", `${has.fn("is_coach_of_athlete(uuid)")} and ${has.fnName("is_group_coach")}`],
      ["the notification types list exists and can be read (notifications_type_check)", "exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)"],
      ["0294 is not already applied (client_nutrition_preferences is not there yet)", has.noTable("client_nutrition_preferences")],
      ["0294 is not already applied (client_nutrition_feedback is not there yet)", has.noTable("client_nutrition_feedback")],
    ],
  },
  {
    n: "40",
    slug: "0295",
    title: "0295 about you, a starting target for a new client, and the phase a client is in: activity level and units on the client's own details (a coach writes the calculator inputs only through one function), a baseline kind of check-in suggestion with a fixed-wording notice to the coaches, the phase of record (coach-only, filled in from existing check-ins and milestone tags), and a coach-proposed goal that can carry a phase which becomes the phase of record only when the client confirms it, plus one new notification type added to the list the database already has",
    migrations: ["0295"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: a client fills in 'About you' (height, sex, activity, units) and a new client gets a starting target the coach reviews; a coach sees and edits the phase a client is in, with a review date and a planned next phase the client never sees; a goal a coach proposes can carry a phase, and the client confirming it moves the phase. Existing clients are given a phase of record from their latest check-in (or their milestone tag). One existing function is rebuilt (guard_client_goal_update: a client's counter-proposal now clears a proposed phase; its permissions are untouched). Run it together with the release's code deploy.",
    undo: [
      "do $undo$ declare v_def text; v_have text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; delete from public.notifications where type = 'nutrition_baseline_ready'; select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m; v_have := array(select t from unnest(v_have) as t where t <> 'nutrition_baseline_ready'); alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_have) as t)); end $undo$;",
      "drop trigger if exists nutrition_baseline_notify on public.nutrition_checkin_suggestions;",
      "drop trigger if exists client_goals_phase_follows_confirm on public.client_goals;",
      "drop trigger if exists client_goals_clear_phase_on_insert on public.client_goals;",
      fnFromMigration("0284", "guard_client_goal_update"),
      "alter table public.client_goals drop constraint if exists client_goals_nutrition_phase_ok;",
      "alter table public.client_goals drop column if exists nutrition_phase;",
      "drop table if exists public.client_phase_plans;",
      "delete from public.nutrition_checkin_suggestions where kind = 'baseline';",
      "delete from public.nutrition_checkins where kind = 'baseline';",
      "alter table public.nutrition_checkin_suggestions drop constraint if exists nutrition_checkin_suggestions_weekly_complete;",
      "alter table public.nutrition_checkins drop constraint if exists nutrition_checkins_weekly_complete;",
      "alter table public.nutrition_checkin_suggestions alter column prev_weight_lbs set not null, alter column curr_weight_lbs set not null, alter column current_calories set not null, alter column adherence_days set not null, alter column recovery_rating set not null, alter column adjustment_pct set not null;",
      "alter table public.nutrition_checkins alter column prev_weight_lbs set not null, alter column curr_weight_lbs set not null, alter column current_calories set not null, alter column adherence_days set not null, alter column recovery_rating set not null, alter column adjustment_pct set not null;",
      "alter table public.nutrition_checkin_suggestions drop constraint if exists nutrition_checkin_suggestions_kind_ok;",
      "alter table public.nutrition_checkins drop constraint if exists nutrition_checkins_kind_ok;",
      "alter table public.nutrition_checkin_suggestions drop column if exists kind, drop column if exists below_floor;",
      "alter table public.nutrition_checkins drop column if exists kind;",
      "drop function if exists public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean);",
      "drop function if exists public.notify_on_nutrition_baseline();",
      "drop function if exists public.phase_follows_confirmed_goal();",
      "drop function if exists public.clear_client_goal_phase_on_insert();",
      "alter table public.athlete_profile_details drop constraint if exists athlete_profile_details_activity_level_ok, drop constraint if exists athlete_profile_details_weight_unit_ok, drop constraint if exists athlete_profile_details_portion_units_ok;",
      "alter table public.athlete_profile_details drop column if exists activity_level, drop column if exists weight_unit, drop column if exists portion_units;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 40 misbehaves. Removes the phase-of-record table (every phase, review date and planned next phase is lost), the activity level and unit settings clients saved, and every baseline suggestion and record; puts the weight, calorie, adherence and recovery columns back to required; puts guard_client_goal_update back exactly as 0284 had it; deletes the new notification and puts the notification types back to the list the database had without it (read from the live list, so another release's types are kept).",
    rows: [
      ["athlete_profile_details, nutrition_checkins, nutrition_checkin_suggestions, client_goals, nutrition_phases and notifications exist", `${has.table("athlete_profile_details")} and ${has.table("nutrition_checkins")} and ${has.table("nutrition_checkin_suggestions")} and ${has.table("client_goals")} and ${has.table("nutrition_phases")} and ${has.table("notifications")}`],
      ["is_group_coach exists and guard_client_goal_update exists (0284 is applied)", `${has.fnName("is_group_coach")} and ${has.fn("guard_client_goal_update()")}`],
      ["the notification types list exists and can be read (notifications_type_check)", "exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)"],
      ["0295 is not already applied (client_phase_plans is not there yet)", has.noTable("client_phase_plans")],
      ["0295 is not already applied (athlete_profile_details has no activity_level yet)", has.noCol("athlete_profile_details", "activity_level")],
      ["0295 is not already applied (client_goals has no nutrition_phase yet)", has.noCol("client_goals", "nutrition_phase")],
    ],
  },
  {
    n: "41",
    slug: "0296",
    title: "0296 recipe library columns: where a recipe came from (the coach or an approved AI option), tags computed when it is saved (allergens, intolerances, diets), its main protein, its reference macros, a fingerprint so the same option saved twice is one recipe, and the line amounts the meal builder scales; a line of an AI recipe must be matched to a real food",
    migrations: ["0296"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: the meal builder offers a client's day from the starter library and the coach's own recipes first, and a coach can save an approved AI option to their private library. Existing recipes keep working exactly as they are (every new column is empty or has a safe default, and who can read or write a recipe does not change). No existing function is replaced. Run it together with the release's code deploy.",
    undo: [
      "drop trigger if exists recipe_ingredients_guard_ai on public.recipe_ingredients;",
      "drop function if exists public.guard_ai_recipe_ingredient();",
      "drop index if exists public.recipes_owner_content_hash_uniq;",
      "alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_grams_ref_ok;",
      "alter table public.recipe_ingredients drop column if exists grams_ref;",
      "alter table public.recipes drop constraint if exists recipes_source_ok, drop constraint if exists recipes_visibility_ok, drop constraint if exists recipes_tags_ok, drop constraint if exists recipes_main_protein_ok, drop constraint if exists recipes_reference_macros_ok, drop constraint if exists recipes_content_hash_ok;",
      "alter table public.recipes drop column if exists source, drop column if exists visibility, drop column if exists allergens, drop column if exists intolerance_tags, drop column if exists diet_tags, drop column if exists main_protein, drop column if exists reference_macros, drop column if exists verified_at, drop column if exists content_hash;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if the recipe library misbehaves after step 41. Removes the new recipe columns and their checks (the source, tags, main protein, reference macros and fingerprint of every saved recipe are lost, and the line amounts the builder scales), the unique fingerprint index, and the AI-line guard. The recipes and their lines themselves stay.",
    rows: [
      ["recipes and recipe_ingredients exist", `${has.table("recipes")} and ${has.table("recipe_ingredients")}`],
      ["0296 is not already applied (recipes has no content_hash yet)", has.noCol("recipes", "content_hash")],
      ["0296 is not already applied (recipe_ingredients has no grams_ref yet)", has.noCol("recipe_ingredients", "grams_ref")],
    ],
  },
  {
    n: "42",
    slug: "0297",
    title: "0297 pause, freeze or cancel a client's weekly schedule: a client asks (their own schedule only) and the change takes effect on the date they chose unless the coach handles it first; the request table, a coach-only table for the client's private note, the freeze dates on the schedule, the functions the app uses to apply a request and to restart a freeze on its day, a freeze that adds its length to the expiry of the client's unused sessions through the expiry hold that already exists, and three new notification types added to the list the database already has",
    migrations: ["0297"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: a client with a weekly schedule sees My schedule with three buttons (pause, freeze, cancel), chooses a date and sends; the coach sees the request in Needs your decision and the schedule changes by itself on the chosen date (or when the coach presses Done on or after it). A freeze restarts on its day and adds its length to the expiry of the client's unused sessions (only for a coach who has an expiry window). No existing function is replaced and no existing row changes.",
    undo: [
      "do $undo$ declare v_def text; v_have text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; delete from public.notifications where type in ('schedule_request', 'schedule_applied', 'schedule_resumed'); select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m; v_have := array(select t from unnest(v_have) as t where t not in ('schedule_request', 'schedule_applied', 'schedule_resumed')); alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_have) as t)); end $undo$;",
      "drop trigger if exists recurring_series_freeze_guard on public.recurring_booking_series;",
      "drop function if exists public.recurring_series_freeze_guard();",
      "drop trigger if exists schedule_requests_audit on public.schedule_requests;",
      "drop table if exists public.schedule_request_notes;",
      "drop table if exists public.schedule_requests;",
      "drop function if exists public.request_schedule_change(uuid, text, date, date, text);",
      "drop function if exists public.withdraw_schedule_request(uuid);",
      "drop function if exists public.dismiss_schedule_request(uuid);",
      "drop function if exists public.claim_schedule_request(uuid, boolean);",
      "drop function if exists public.claim_due_schedule_requests(integer);",
      "drop function if exists public.finish_schedule_request(uuid, boolean, boolean, boolean, text);",
      "drop function if exists public.end_schedule_freeze(uuid, date);",
      "drop function if exists public.claim_due_freeze_resumes(integer);",
      "drop function if exists public.fail_freeze_resume(uuid, text);",
      "drop function if exists public.note_schedule_resumed(uuid, integer, integer);",
      "drop function if exists public.settle_schedule_freeze(uuid, uuid, uuid, date, date, integer);",
      "drop function if exists public.shorten_expiry_after_freeze(uuid, uuid, uuid, integer, text);",
      "drop function if exists public.extend_expiry_for_freeze(uuid, uuid, uuid, integer, text);",
      "drop function if exists public.schedule_expiry_window_days(uuid, uuid);",
      "drop function if exists public.schedule_request_recipients(uuid, uuid);",
      "drop function if exists public.schedule_local_today(text, uuid);",
      "alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_frozen_hold_ok;",
      "alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_frozen_ok;",
      "alter table public.recurring_booking_series drop column if exists frozen_from, drop column if exists frozen_until, drop column if exists resume_claimed_at, drop column if exists resume_attempts, drop column if exists resume_error, drop column if exists frozen_hold_days;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if schedule requests misbehave after step 42. Removes the two request tables (every request and every private note is lost), their audit trigger, the functions, and the freeze columns on the schedule (a schedule that is frozen stays paused: restart it from the client's profile), deletes the three new kinds of notification and puts the notification types back to the list the database had without them (read from the live list, so another release's types are kept). An expiry hold that a freeze already set stays as it is (a coach can clear it on the client's profile). Nothing else is touched.",
    rows: [
      ["recurring_booking_series, session_credits and session_credit_ledger exist", `${has.table("recurring_booking_series")} and ${has.table("session_credits")} and ${has.table("session_credit_ledger")}`],
      ["the expiry hold and the coach's expiry window exist (0280, 0209)", `${has.col("session_credits", "expiry_hold_until")} and ${has.col("coach_booking_policies", "credit_expiry_days")}`],
      ["is_group_coach, is_org_admin_of_group, coach_time_zone and audit_watch exist (the new row security and functions use them)", `${has.fnName("is_group_coach")} and ${has.fnName("is_org_admin_of_group")} and ${has.fnName("coach_time_zone")} and ${has.fnName("audit_watch")}`],
      ["the notification types list exists and can be read (notifications_type_check)", "exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)"],
      ["0297 is not already applied (schedule_requests is not there yet)", has.noTable("schedule_requests")],
      ["0297 is not already applied (recurring_booking_series has no frozen_from yet)", has.noCol("recurring_booking_series", "frozen_from")],
    ],
  },
  {
    n: "43",
    slug: "0298",
    title: "0298 Read during rest: the client's own on/off switch (a table only that client can read or write), the coach's switch for all their clients, the coach's choice of passage for a day, and one function the client's screen asks (is Read on for me here, is there a coach's passage today, have I seen the note); the passages themselves are in the app",
    migrations: ["0298"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: a client who opens the rest timer sees a Read button beside the games (on for everyone by default, one tap turns it off, in the Read panel or in Settings); a coach can turn Read off for all their clients in Settings, which hides it entirely for them, and can choose the passage for a day. No existing function is replaced and no existing row changes.",
    undo: [
      "drop function if exists public.read_track_for_me(uuid, date);",
      "drop table if exists public.read_passage_overrides;",
      "drop table if exists public.read_settings;",
      "alter table public.coach_preferences drop column if exists faith_track_default;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if Read misbehaves after step 43. Removes the client switches and note records (every client is back to the default, Read on), the coach's day-by-day passages, the coach's switch for all their clients, and the one function. The passages are in the app and are not touched.",
    rows: [
      ["profiles, group_memberships and coach_preferences exist", `${has.table("profiles")} and ${has.table("group_memberships")} and ${has.table("coach_preferences")}`],
      ["0298 is not already applied (read_settings is not there yet)", has.noTable("read_settings")],
      ["0298 is not already applied (coach_preferences has no faith_track_default yet)", has.noCol("coach_preferences", "faith_track_default")],
    ],
  },
  {
    n: "45",
    slug: "0300",
    title: "0300 Food search and logging: USDA household portions (public reference table), a record of which USDA batches were loaded, and the optional detail of a searched food on a food log entry (source, USDA food, grams, serving, nutrient snapshot), with sanity limits on what can be logged from now on",
    migrations: ["0300"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: any client can search the USDA foods, pick a serving (grams, ounces, household measures once the USDA portions are loaded), see the nutrients and log it, then edit or delete the entry. Existing food logs are untouched.",
    undo: [
      "alter table public.food_log_entries drop constraint if exists food_log_entries_amounts_sane;",
      "alter table public.food_log_entries drop constraint if exists food_log_entries_detail_check;",
      "alter table public.food_log_entries drop constraint if exists food_log_entries_food_source_check;",
      "alter table public.food_log_entries drop column if exists food_source, drop column if exists fdc_id, drop column if exists amount_g, drop column if exists serving_label, drop column if exists serving_qty, drop column if exists nutrients, drop column if exists barcode;",
      "alter table public.group_memberships drop column if exists food_tracking_enabled;",
      "drop function if exists public.search_usda_foods(text[], integer);",
      "drop table if exists public.usda_load_batches;",
      "drop table if exists public.usda_food_portions;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 45 misbehaves. Removes the portions table, the batch record and the new optional columns on food_log_entries (the detail of searched foods logged since is lost; the calories and macros of those entries stay). Nothing else is touched.",
    rows: [
      ["food_log_entries and usda_foods exist", `${has.table("food_log_entries")} and ${has.table("usda_foods")}`],
      ["0300 is not already applied (usda_food_portions is not there yet)", has.noTable("usda_food_portions")],
      ["0300 is not already applied (food_log_entries has no fdc_id yet)", has.noCol("food_log_entries", "fdc_id")],
      ["0300 is not already applied (group_memberships has no food_tracking_enabled yet)", has.noCol("group_memberships", "food_tracking_enabled")],
    ],
  },
  {
    n: "46",
    slug: "0301",
    title: "0301 AI budget: one pool per organization (its size, and this month's AI use summed by model, both server-only), paid top-up packs (a balance that carries over from month to month; the small step 50 record after the deploy keeps what each month used), and a record that the owner and coach were told the AI is running low or used up, once per month",
    migrations: ["0301"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: each organization (a solo coach, or a gym's trainers together) has one monthly AI budget measured in real cost; the app tells the owner and the coach plainly at about 80 percent and when it is used up, and pauses AI features until the 1st, unless a paid top-up balance (when payments are on) takes over; a top-up balance is spent only after the month's included AI is used up and carries over from month to month with no expiry, while the included AI refreshes on the 1st. Food search, barcode and saved meals are never limited. A top-up that is refunded in Stripe does NOT take its dollars back out of the balance; delete that row from ai_budget_topups by hand if a refund is ever given (the balance falls by that amount, but only down to what is unspent).",
    undo: [
      "drop table if exists public.ai_budget_notices;",
      "drop table if exists public.ai_budget_topups;",
      "drop function if exists public.ai_org_month_usage(uuid, timestamptz);",
      "drop function if exists public.ai_org_summary(uuid);",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 46 misbehaves. Removes the budget helper functions, the top-up record and the once-a-month notice record (a paid top-up recorded since would be lost from the budget; the payment itself is in Stripe). The AI usage log itself is not touched.",
    rows: [
      ["ai_usage_log exists", has.table("ai_usage_log")],
      ["organizations, organization_billing, organization_memberships and coach_credits exist (the budget reads them)", `${has.table("organizations")} and ${has.table("organization_billing")} and ${has.table("organization_memberships")} and ${has.table("coach_credits")}`],
      ["0301 is not already applied (ai_org_summary is not there yet)", "not exists (select 1 from pg_proc where proname = 'ai_org_summary' and pronamespace = 'public'::regnamespace)"],
      ["0301 is not already applied (ai_budget_notices is not there yet)", has.noTable("ai_budget_notices")],
    ],
  },
  {
    n: "47",
    slug: "0302",
    title: "0302 Custom foods and saved meals: a client's own foods (with the numbers from a label, an optional full label and a barcode) and meals saved from several foods, private to the client and readable by their coaches, with limits on how many",
    migrations: ["0302"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until the code in the same release is live. After that: a client can add a food that is not in the USDA data (a bar, a restaurant dish, a family recipe), scan a barcode that is not found and create it, and save a meal to log again in one tap. Their coach can see these.",
    undo: [
      "drop table if exists public.saved_meal_items;",
      "drop table if exists public.saved_meals;",
      "drop table if exists public.custom_foods;",
      "drop function if exists public.guard_food_library_limits();",
      "drop function if exists public.food_library_touch_updated_at();",
      "drop function if exists public.nutrients_are_numbers(jsonb, numeric);",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 47 misbehaves. Removes the custom foods and saved meals people created since (what they logged from them stays in their food log).",
    rows: [
      ["profiles, usda_foods and is_coach_of_athlete exist", `${has.table("profiles")} and ${has.table("usda_foods")} and ${has.fnName("is_coach_of_athlete")}`],
      ["0302 is not already applied (custom_foods is not there yet)", has.noTable("custom_foods")],
      ["0302 is not already applied (saved_meals is not there yet)", has.noTable("saved_meals")],
    ],
  },
  {
    n: "48",
    slug: "0303",
    title: "0303 What a client pays becomes coach-only (part one): the coach's manual monthly rate moves off the roster table (which every member of a group could read) into its own table that only the group's coaches can read or write (the organization's owner and admins can read it); the existing rates are copied across and the old column is emptied, so the leak is closed at once",
    migrations: ["0303"],
    sees: "Success. No rows returned.",
    afterwards: "Clients can no longer see what any client pays. The code that is live today still finds the old rate column (now empty) and carries on; the Business estimate shows nothing until the code in the same release is live, then shows the same rates as before. Step 49 (after the deploy) removes the old column.",
    undo: [
      "alter table public.group_memberships add column if not exists monthly_rate numeric check (monthly_rate is null or monthly_rate >= 0);",
      "update public.group_memberships gm set monthly_rate = r.monthly_rate from public.client_billing_rates r where r.membership_id = gm.id;",
      "drop table if exists public.client_billing_rates;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 48 misbehaves. Puts the rates back on the roster table (the old column) and removes the new table. Note this makes the rates readable by every member of a group again (the problem step 48 fixes).",
    rows: [
      ["group_memberships, groups, is_group_coach and is_org_admin_of_group exist", `${has.table("group_memberships")} and ${has.table("groups")} and ${has.fnName("is_group_coach")} and ${has.fnName("is_org_admin_of_group")}`],
      ["0303 is not already applied (client_billing_rates is not there yet)", has.noTable("client_billing_rates")],
      ["the old rate column is still on group_memberships", has.col("group_memberships", "monthly_rate")],
    ],
  },
  {
    n: "49",
    slug: "0304",
    title: "0304 What a client pays (part two): drops the old, now empty, rate column from the roster table (anything the old code wrote there since step 48 is copied across first)",
    warn: "Run this ONLY AFTER the release's code is deployed and live: code that still selects the old column in the same query as the roster would stop showing the roster. Step 48 must already be applied.",
    migrations: ["0304"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. The old rate column is gone; the rates live only in the coach-only table.",
    undo: [
      "alter table public.group_memberships add column if not exists monthly_rate numeric check (monthly_rate is null or monthly_rate >= 0);",
      "update public.group_memberships gm set monthly_rate = r.monthly_rate from public.client_billing_rates r where r.membership_id = gm.id;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 49 misbehaves. Puts the old rate column back with the current rates (which makes them readable by every group member again, so follow it with step 48's undo only if you mean to go all the way back).",
    rows: [
      ["step 48 is applied (client_billing_rates exists)", has.table("client_billing_rates")],
      ["0304 is not already applied (the old rate column is still on group_memberships)", has.col("group_memberships", "monthly_rate")],
    ],
  },
  {
    n: "51",
    slug: "0306",
    title: "0306 Target-change notice: when a coach applies a new daily calorie target the client is told, with fixed wording and a link to their Nutrition page, so they can answer 'are you happy with your meal plan?' (adds one notification type to the list the database already has)",
    migrations: ["0306"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes until the code of the same release is live. After that, when a coach applies a new target the client gets a bell notice and a card asking if they are happy with their meal plan; the coach sees the answer in Preferences.",
    undo: [
      "drop trigger if exists client_macro_target_history_notify on public.client_macro_target_history;",
      "drop function if exists public.notify_on_target_change();",
      "delete from public.notifications where type = 'nutrition_target_changed';",
      "do $undo$ declare v_def text; v_types text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; select array_agg(m[1] order by m[1]) into v_types from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'nutrition_target_changed'; alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_types) as t)); end $undo$;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 51 misbehaves. Removes the trigger, the function, any target-change notices already sent, and the notification type.",
    rows: [
      ["client_macro_target_history and notifications exist", `${has.table("client_macro_target_history")} and ${has.table("notifications")}`],
      ["0306 is not already applied (the notice function is not there yet)", "not exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace)"],
    ],
  },
  {
    n: "54",
    slug: "0309",
    title: "0309 New training block notice: when a coach moves a client to a new phase the client sees one plain line in their bell, with no phase words (adds one notification type to the list the database already has)",
    migrations: ["0309"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes until the code of the same release is live. After that, when a coach moves a client to their planned next phase the client gets the bell line \"Your coach started a new training block with you.\" (the push notice is sent by the app).",
    undo: [
      "drop trigger if exists client_phase_plans_notify_new_block on public.client_phase_plans;",
      "drop function if exists public.notify_on_new_training_block();",
      "delete from public.notifications where type = 'new_training_block';",
      "do $undo$ declare v_def text; v_types text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; select array_agg(m[1] order by m[1]) into v_types from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'new_training_block'; alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_types) as t)); end $undo$;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 54 misbehaves. Removes the trigger, the function, any new-training-block notices already sent, and the notification type.",
    rows: [
      ["client_phase_plans and notifications exist", `${has.table("client_phase_plans")} and ${has.table("notifications")}`],
      ["0309 is not already applied (the notice function is not there yet)", "not exists (select 1 from pg_proc where proname = 'notify_on_new_training_block' and pronamespace = 'public'::regnamespace)"],
    ],
  },
  {
    n: "50",
    slug: "0305",
    title: "0305 AI top-up balance that carries over: a small server-only record of how much of the top-up balance each month used, so a paid top-up is spent after the month's included AI and the rest carries into the next month",
    migrations: ["0305"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes by itself. Once payments are on, a coach who buys an AI top-up keeps the unused part from one month to the next; the included monthly AI still refreshes on the 1st. Until this step is run the app uses the bought total and records nothing, so it is safe to run any time after Release N.",
    undo: ["drop table if exists public.ai_topup_draws;"].join(String.fromCharCode(10)),
    undoWhy: "Only if step 50 misbehaves. Removes the record of what past months drew from the top-up balance (the balance then reads as everything ever bought).",
    rows: [
      ["organizations exists", has.table("organizations")],
      ["step 46 is applied (ai_budget_topups exists)", has.table("ai_budget_topups")],
      ["0305 is not already applied (ai_topup_draws is not there yet)", has.noTable("ai_topup_draws")],
    ],
  },
];

const bar = "-- ".padEnd(3) + "=".repeat(100);
const header = (s, kind) => {
  const lines = [
    `-- STEP ${s.n}${kind === "precheck" ? " (PRECHECK, run first, changes nothing)" : ""}: ${s.title}`,
    "--",
  ];
  if (s.warn) lines.push(`-- !! ${s.warn}`, "--");
  if (kind === "precheck") {
    lines.push(
      "-- Paste into the Supabase SQL editor and run. Every row must say ok = true.",
      "-- If any row says false: do NOT run the apply file. Copy the result table and send it back.",
    );
  } else {
    lines.push(
      "-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.",
      `-- WHAT YOU SHOULD SEE: "${s.sees}"`,
      `-- AFTERWARDS: ${s.afterwards}`,
      "-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.",
      "-- It contains no text searching, so editor re-indenting cannot break it.",
    );
  }
  return lines.join("\n");
};

// A guard stops a step from being run twice by mistake or on top of newer work: the "not already applied" rows are checked INSIDE the apply file
// as its first statement, and it raises (so nothing runs) if any is false.
const guardFor = (s) => {
  const guards = s.rows.filter(([name]) => /not already applied/.test(name));
  if (guards.length === 0) return "";
  const cond = guards.map(([, expr]) => `(${expr})`).join("\n     and ");
  return [
    "do $guard$",
    "begin",
    `  if not (${cond}) then`,
    `    raise exception 'Step ${s.n} (${s.slug}) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';`,
    "  end if;",
    "end",
    "$guard$;",
    "",
    "",
  ].join("\n");
};

for (const s of STEPS) {
  const base = `apply-step${s.n}-${s.slug}`;
  const values = s.rows.map(([name, expr]) => `    ('${name.replace(/'/g, "''")}',\n      ${expr}`.concat(")")).join(",\n");
  const pre = `${header(s, "precheck")}\nselect check_name, ok\nfrom (\n  values\n${values}\n) as checks(check_name, ok);\n`;
  writeFileSync(new URL(`${base}-precheck.sql`, outDir), pre);
  const body = s.bodySql
    ? `${bar}\n-- ${s.slug}: one-time data change\n${bar}\n\n${s.bodySql}\n`
    : s.migrations.map((n) => `${bar}\n-- migration ${index[n]}\n${bar}\n\n${migrationSql(n)}\n`).join("\n");
  writeFileSync(new URL(`${base}.sql`, outDir), `${header(s, "apply")}\n\nbegin;\n\n${guardFor(s)}${body}\ncommit;\n`);
  if (s.undo) {
    writeFileSync(
      new URL(`undo-step${s.n}-${s.slug}.sql`, outDir),
      [
        `-- UNDO for step ${s.n} (${s.slug}). ${s.undoWhy}`,
        '-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.',
        "begin;",
        s.undo,
        "commit;",
        "",
      ].join("\n")
    );
  }
}
// ---- release bundles: ONE paste file per release (apply-release-<x>-all.sql) ----
// All of a release's steps, in order, inside ONE all-or-nothing transaction. Every check row of every step (its precheck, including "not already applied") is folded
// into a guard in front of that step, evaluated inside the transaction (so a later step sees the earlier ones' changes). A false row stops everything with a message
// that names the release, the step and the failed checks, and nothing is kept. After the commit one read-only result row per step says whether it is in place.
// The individual step files stay as the fallback (and for a release that was partly applied by hand: the bundle refuses at the first applied step).
const BUNDLES = [
  { id: "release-d", name: "Release D", steps: ["32", "33", "34"] },
  { id: "release-f", name: "Release F", steps: ["35", "36", "37"] },
  { id: "release-h", name: "Release H (refund fix)", steps: ["38"] },
  { id: "release-i", name: "Release I (food preferences)", steps: ["39"] },
  { id: "release-j", name: "Release J (about you, baseline, phase of record)", steps: ["40"] },
  { id: "release-k", name: "Release K (recipe library)", steps: ["41"] },
  { id: "release-l", name: "Release L (schedule requests, Read during rest)", steps: ["42", "43"] },
  { id: "release-n", name: "Release N (nutrition tracking: food search, custom foods, nutrient detail)", steps: ["45", "46", "47", "48"] },
  { id: "release-o", name: "Release O (recalculation notice)", steps: ["51"] },
  { id: "release-p", name: "Release P (new training block notice)", steps: ["54"] },
  { id: "release-n2", name: "Release N part 2 (run AFTER the release code is deployed: drops the old rate column)", steps: ["49", "50"] },
];
for (const b of BUNDLES) {
  const stepsIn = b.steps.map((n) => STEPS.find((x) => x.n === n));
  const parts = [];
  const summary = [];
  for (const s of stepsIn) {
    const values = s.rows.map(([name, expr]) => `      ('${name.replace(/'/g, "''")}', ${expr})`).join(",\n");
    const tag = `g${s.n}`;
    parts.push(
      [
        `-- ===== ${b.name}, step ${s.n}: ${s.title}`,
        `do $${tag}$`,
        "declare",
        "  failed text;",
        "begin",
        "  select string_agg(check_name, '; ') into failed from (",
        "    values",
        values,
        "  ) as checks(check_name, ok) where not ok;",
        "  if failed is not null then",
        `    raise exception '${b.name}, step ${s.n} (${s.slug}) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;`,
        "  end if;",
        "end",
        `$${tag}$;`,
        "",
        s.bodySql
          ? s.bodySql
          : s.migrations.map((n) => `${bar}\n-- migration ${index[n]}\n${bar}\n\n${migrationSql(n)}`).join("\n\n"),
        "",
      ].join("\n")
    );
    // "In place" for the result row: the step's own "not already applied" checks are no longer all true.
    const guards = s.rows.filter(([name]) => /not already applied/.test(name));
    const placed = guards.length ? `not (${guards.map(([, e]) => `(${e})`).join(" and ")})` : "true";
    summary.push(`  select 'step ${s.n} (${s.slug})' as step, '${s.title.split(/[(,;]/)[0].trim().replace(/'/g, "''")}' as what, ${placed} as in_place`);
  }
  const head = [
    `-- ${b.name.toUpperCase()}: ONE paste. Steps ${b.steps.join(", ")} in order, all or nothing.`,
    "--",
    "-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).",
    "-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the",
    "-- failed check, and NOTHING is kept, so a second run after a refusal is safe.",
    "-- WHAT YOU SHOULD SEE: first \"Success\" for the transaction, then a result table with one row per step and in_place = true on every row.",
    "-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.",
    ...stepsIn.flatMap((s) => [`-- AFTER STEP ${s.n}: ${s.afterwards}`]),
    "-- It contains no text searching, so editor re-indenting cannot break it.",
  ].join("\n");
  const sql = `${head}\n\nbegin;\n\n${parts.join("\n")}\ncommit;\n\n-- Read-only result (after the commit): every row must say in_place = true.\nselect step, what, in_place from (\n${summary.join("\n  union all\n")}\n) as result order by step;\n`;
  writeFileSync(new URL(`apply-${b.id}-all.sql`, outDir), sql);
}
writeFileSync(new URL("bundles.json", outDir), JSON.stringify(BUNDLES.map((b) => ({ ...b, file: `apply-${b.id}-all.sql` })), null, 1));

// ---- restore-step31-from-backup.sql: puts back what step 31 deleted, from the most recent cleanup_backups record ----
{
  const order = [
    ["groups", "groups"],
    ["memberships", "group_memberships"],
    ["programs", "programs"],
    ["progressions", "exercise_progressions"],
    ["workouts", "workouts"],
    ["exercises", "group_workout_exercises"],
    ["sets", "group_workout_exercise_sets"],
    ["notes", "workout_notes"],
    ["wellness_checkins", "wellness_checkins"],
    ["coach_view_state", "coach_view_state"],
    ["programming_spotter_dismissals", "programming_spotter_dismissals"],
  ];
  const lines = order.map(([k, tbl]) => `  insert into public.${tbl} select * from jsonb_populate_recordset(null::public.${tbl}, b.payload -> '${k}');`);
  const sql = [
    "-- RESTORE for step 31 (delete-two-groups). Only if Main Group or the stray Coast to Coast group turns out to be needed again.",
    "-- Puts back, from the most recent record in cleanup_backups, both groups with their memberships, programs, progressions, workouts, exercises, sets, notes,",
    "-- wellness check-ins, view state and Spotter dismissals, in that order, in one transaction. It refuses (and changes nothing) if there is no backup, or if either",
    "-- group already exists. The copy of christmas_abs_program in The Home Team is not touched.",
    "-- Only reliable soon after step 31: it fills columns from the backup, so a NOT NULL column added by a later migration to one of these tables would make it fail (loudly, and nothing is kept).",
    '-- WHAT YOU SHOULD SEE: "Success. No rows returned."',
    "begin;",
    "do $restore$",
    "declare",
    "  b record;",
    "begin",
    "  select * into b from public.cleanup_backups where label like 'delete Main Group%' order by taken_at desc limit 1;",
    "  if b.id is null then raise exception 'There is no step 31 backup in cleanup_backups, so nothing was restored.'; end if;",
    "  if exists (select 1 from public.groups where id in (select (x ->> 'id')::uuid from jsonb_array_elements(b.payload -> 'groups') x)) then",
    "    raise exception 'One of the groups already exists, so nothing was restored.';",
    "  end if;",
    ...lines,
    "end",
    "$restore$;",
    "commit;",
    "",
  ].join("\n");
  writeFileSync(new URL("restore-step31-from-backup.sql", outDir), sql);
}
// ---- apply-0248.sql: already applied; kept so that running it again can never silently undo 0236 ----
{
  const guard = [
    "do $guard$",
    "begin",
    "  if not coalesce((select md5(pg_get_functiondef(p.oid)) = '49fe3d6b3ec9ecb92f44b1087574dfb0' from pg_proc p where p.proname = 'complete_workout_session' and p.pronamespace = 'public'::regnamespace), false) then",
    "    raise exception 'complete_workout_session is no longer the version 0248 was built from (0248 or 0236 is probably already applied). Running this file again would overwrite it. Nothing was changed.';",
    "  end if;",
    "end",
    "$guard$;",
  ].join("\n");
  const head = [
    "-- STEP 2 of 2 for migration 0248 (session credit settlement). Run apply-0248-precheck.sql first: every row must say ok = true.",
    "-- ALREADY APPLIED. Do not run it again: the guard below refuses if the live complete_workout_session is no longer the version this file was built from,",
    "-- because running it again would replace the function and silently undo 0236's protection against a double Finish.",
    "-- One transaction: any error rolls back all of it. Nothing in this file matches or searches existing text.",
  ].join("\n");
  writeFileSync(new URL("../apply-0248.sql", outDir), `${head}\n\nbegin;\n\n${guard}\n\n${migrationSql("0248")}\n\ncommit;\n`);
}

// ---- record-history-applied.sql: put the hand-applied migrations into supabase_migrations.schema_migrations ----
// One file Ron can run at any time: it records only the migrations whose changes are actually in the database (each has a marker check), skips ones
// already recorded, and does nothing for the rest, so it can be run again after later steps. Versions are fixed (20261006 + the migration number),
// so running it again never duplicates.
{
  const m = (n, marker) => ({ n, file: index[n], marker });
  const items = [
    m("0236", "exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workout_logs_session_id_key')"),
    m("0237", has.fnName("join_group_with_invite")),
    m("0238", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check not like '%has_valid_group_invite%')"),
    m("0240", has.col("profiles", "guide_dismissed_at")),
    m("0241", has.col("programs", "label")),
    m("0242", has.col("group_invites", "revoked_at")),
    m("0244", has.table("client_macro_target_history")),
    m("0248", has.col("bookings", "credit_state")),
    m("0249", has.col("coach_profiles", "completion_message")),
    m("0250", has.col("organization_billing", "ai_allowance_scale")),
    m("0251", has.table("kiosk_pins")),
    m("0252", has.noCol("group_memberships", "kiosk_pin")),
    m("0253", has.noPolicy("posts", "posts_select_public_workout_share")),
    m("0254", has.policy("client_tags", "client_tags_insert_owner_admin")),
    m("0255", has.table("legal_acceptances")),
    m("0256", has.col("organizations", "listed_in_marketplace")),
    m("0257", has.table("feedback_reports")),
    m("0258", has.table("nav_query_log")),
    m("0259", has.col("recurring_booking_series", "mode")),
    m("0260", has.col("session_credits", "payment_hold")),
    m("0261", has.table("coach_booking_pages")),
    m("0262", has.table("cron_runs")),
    m("0263", has.table("group_sessions")),
    m("0264", has.policy("session_credits", "credits_update_coach")),
    m("0265", has.policy("bookings", "bookings_update_coach")),
    m("0266", "exists (select 1 from pg_trigger where tgname = 'profiles_guard_sensitive_columns')"),
    m("0267", has.table("audit_log")),
    m("0268", has.fnName("guard_athlete_session_insert")),
    m("0269", has.fnName("guard_group_session_bookings")),
    m("0270", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check like '%is_coach_of_athlete%')"),
    m("0271", "not has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')"),
    m("0272", "not has_function_privilege('anon', 'public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text)', 'execute')"),
    m("0273", "exists (select 1 from pg_trigger where tgname = 'groups_guard_columns')"),
    m("0274", "coalesce((select position('tg_op' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'block_athlete_edits_to_completed_session' and p.pronamespace = 'public'::regnamespace), false)"),
    m("0275", "exists (select 1 from pg_trigger where tgname = 'bookings_note_series_skip')"),
    m("0276", "exists (select 1 from pg_trigger where tgname = 'direct_messages_notify')"),
    m("0277", has.col("bookings", "late_charge_state")),
    m("0278", has.col("coach_booking_policies", "booking_mode")),
    m("0279", has.table("booking_requests")),
    m("0280", has.col("session_credits", "expiry_hold_until")),
    m("0281", has.table("client_inactive")),
    m("0286", has.col("recipe_favorites", "kind")),
    m("0287", "exists (select 1 from pg_constraint where conname = 'coach_availability_windows_session_minutes_range' and pg_get_constraintdef(oid) not like '%slot_duration_minutes%')"),
    m("0288", "exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap')"),
    m("0289", has.col("coach_availability_windows", "session_type_id")),
    m("0290", "exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_identity')"),
    m("0291", has.fnName("expire_session_credit_balance")),
    m("0292", has.col("ai_usage_log", "error_class")),
    m("0293", has.fnName("refund_coach_credit_for")),
    m("0294", has.table("client_nutrition_preferences")),
    m("0295", has.table("client_phase_plans")),
    m("0296", has.col("recipes", "content_hash")),
    m("0297", has.table("schedule_requests")),
    m("0309", "exists (select 1 from pg_proc where proname = 'notify_on_new_training_block' and pronamespace = 'public'::regnamespace)"),
    m("0306", "exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace)"),
    m("0305", has.table("ai_topup_draws")),
    m("0304", has.noCol("group_memberships", "monthly_rate")),
    m("0303", has.table("client_billing_rates")),
    m("0302", has.table("custom_foods")),
    m("0301", has.table("ai_budget_notices")),
    m("0300", has.table("usda_food_portions")),
    m("0298", has.table("read_settings")),
    m("0285", has.table("rest_day_nudges")),
    m("0284", has.policy("client_goals", "client_goals_insert_coach")),
    m("0283", has.col("coach_availability_windows", "session_minutes")),
    m("0282", "not has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute') and not has_function_privilege('authenticated', 'public.apply_session_credit_change(uuid, uuid, integer, text, text, uuid, uuid)', 'execute')"),
  ];
  const values = items.map((i) => `    ('2026100600${i.n.slice(1)}', '${i.file.slice(5, -4)}', '${i.file}', ${i.marker})`).join(",\n");
  const sql = [
    "-- Records the migrations Ron applied by hand in the Supabase migration history (supabase_migrations.schema_migrations), so supabase db push and",
    "-- list_migrations show them as applied. NOT APPLIED YET: run it when you are ready. It records a migration only if its change is actually in the",
    "-- database (each row has a check), skips ones already recorded, and does nothing for steps not applied yet, so you can run it again after later steps.",
    '-- WHAT YOU SHOULD SEE: "Success. No rows returned." Then: select version, name from supabase_migrations.schema_migrations order by version desc limit 30;',
    "-- ON ERROR: nothing was recorded (one transaction). Copy the red text and send it to Spot.",
    "begin;",
    "insert into supabase_migrations.schema_migrations (version, name, statements, created_by)",
    "select v.version, v.name, array['-- applied by hand through the SQL editor; the SQL is supabase/migrations/' || v.file], 'ronarnold4210@gmail.com'",
    "from (",
    "  values",
    values,
    ") as v(version, name, file, applied)",
    "where v.applied",
    "on conflict (version) do nothing;",
    "commit;",
    "",
  ].join("\n");
  writeFileSync(new URL("record-history-applied.sql", outDir), sql);
}

// ---- optional-ron-booking-mode-request.sql: OPTIONAL second statement, to set Ron's own mode right after step 20 ----
{
  const sql = [
    "-- OPTIONAL. Run only AFTER step 20 (0278), and ideally after step 21 (0279) so requests work. You can skip it and pick the mode yourself on the Availability page instead.",
    "-- Sets ONE coach to 'Clients request, I confirm': the coach whose login email is below. CHECK that this is the email you sign in to coaching with.",
    "-- If no account has that email it changes nothing. Every other coach stays on 'I schedule everyone' until they choose.",
    "-- WHAT YOU SHOULD SEE: the first result shows the one coach it will change (one row), the second shows 'request' for that coach.",
    "do $guard$ begin if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'booking_mode') then raise exception 'Step 20 (0278) is not applied yet, so there is no booking mode to set. Apply step 20 first. Nothing was changed.'; end if; end $guard$;",
    "select u.id as coach_id, u.email from auth.users u where lower(u.email) = 'trainwithronarnold@gmail.com';",
    "begin;",
    "insert into public.coach_booking_policies (coach_id, booking_mode)",
    "select u.id, 'request' from auth.users u where lower(u.email) = 'trainwithronarnold@gmail.com'",
    "on conflict (coach_id) do update set booking_mode = 'request';",
    "commit;",
    "select bp.coach_id, bp.booking_mode from public.coach_booking_policies bp join auth.users u on u.id = bp.coach_id where lower(u.email) = 'trainwithronarnold@gmail.com';",
    "",
  ].join("\n");
  writeFileSync(new URL("optional-ron-booking-mode-request.sql", outDir), sql);
}

// ---- check-step13-probe.sql: proves, on the live database, that a NEW function is closed to the signed-out role after step 13 ----
{
  const sql = [
    "-- RUN ONCE BEFORE STEP 13 (baseline: anon_can_run = true) AND AGAIN AFTER STEP 13 (must show anon_can_run = false). Read-only in effect: it makes a throwaway function, asks who can run it, and rolls everything back, so no test project is needed.",
    "-- WHAT YOU SHOULD SEE: one row with anon_can_run = false, signed_in_can_run = true, server_can_run = true. If anon_can_run is true, tell Spot.",
    "begin;",
    "create function public.zz_probe() returns int language sql as 'select 1';",
    "select has_function_privilege('anon', 'public.zz_probe()', 'execute') as anon_can_run,",
    "       has_function_privilege('authenticated', 'public.zz_probe()', 'execute') as signed_in_can_run,",
    "       has_function_privilege('service_role', 'public.zz_probe()', 'execute') as server_can_run;",
    "rollback;",
    "",
    "-- And the list of functions a signed-out visitor can still run. Before step 17: get_invite_info, book_discovery_call, submit_gym_visitor_lead. After step 17: only get_invite_info.",
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1;",
    "",
    "-- NOTE for later: step 13 also removes the public-execute default for functions the editor role creates. After any future CREATE EXTENSION run in the SQL editor, grant execute on its functions to authenticated and service_role (or enable it from the Supabase dashboard).",
  ].join("\n");
  writeFileSync(new URL("check-step13-probe.sql", outDir), sql);
}
writeFileSync(new URL("check-function-acl.sql", outDir), functionAclCheckSql());
writeFileSync(new URL("check-copy-result.sql", outDir), "-- READ-ONLY. Run after step 30 and LOOK at it before step 31: the original program and its copy, side by side. The two rows must show the same numbers.\nwith pair as (\n  select 'original (Main Group)' as which, '5b8a8a3a-344d-4192-a892-f74494fff9ab'::uuid as program_id\n  union all\n  select 'copy (The Home Team)', (select id from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program' order by created_at desc limit 1)\n)\nselect p.which,\n  (select count(*) from public.workouts w where w.program_id = p.program_id) as workouts,\n  (select count(*) from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = p.program_id) as exercises,\n  (select count(*) from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = p.program_id) as sets,\n  (select count(*) from public.workout_notes n join public.workouts w on w.id = n.workout_id where w.program_id = p.program_id) as notes,\n  (select count(*) from public.exercise_progressions q where q.program_id = p.program_id) as progressions\nfrom pair p;\n");
writeFileSync(new URL("check-step23-probe.sql", outDir), step23ProbeSql(migrationSql("0281")));
writeFileSync(new URL("steps.json", outDir), JSON.stringify(STEPS.map((s) => ({ n: s.n, slug: s.slug, migrations: s.migrations, rows: s.rows.length })), null, 1));
console.log(`wrote ${STEPS.length} steps to supabase/apply/`);
