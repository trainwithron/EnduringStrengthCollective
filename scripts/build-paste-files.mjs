// Builds the numbered paste-ready SQL files under supabase/apply/ from the migration files: for each step a read-only PRECHECK file (every row
// must say ok = true) and the APPLY file (begin ... commit, so it is all or nothing). Nothing in them searches existing text.
//   node scripts/build-paste-files.mjs
// scripts/sql-tests/paste-files.test.mjs applies every step in order on the live-equivalent schema and checks each precheck is true first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkSql as functionAclCheckSql, undoSql as functionAclUndoSql, TRIGGER_SWEEP, triggerSweepUndoSql } from "./function-acl.mjs";
import { probeSql as step23ProbeSql } from "./step23-probe.mjs";
import { LIVE_TRANSFER_ORGANIZATION_OWNERSHIP } from "./live-bodies-0396.mjs";

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
  // The paste channel garbles non-ASCII characters: a dash inside a string is written with chr(8212) instead (the same text).
  return text.slice(start, end).split(String.fromCharCode(8212)).join("' || chr(8212) || '");
};
const fnFrom0248 = (name) => fnFromMigration("0248", name);
const fnFrom0218 = (name) => fnFromMigration("0218", name);
const fnFrom0277 = (name) => fnFromMigration("0277", name);
const md5Is = (sig, md5) => `coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '${md5}' from pg_proc p where p.oid = to_regprocedure('public.${sig}')), false)`;

// The tables that carry "a person" and "a group" and get the athlete-in-group rule (migration 0340).
const TENANT_TABLES = [
  "minor_consent", "daily_macros", "meal_plans", "athlete_injury_status", "athlete_sessions", "bookings", "programs", "workout_assignments",
  "coach_video_checkins", "nutrition_checkins", "nutrition_phases", "client_habits", "session_credits", "wellness_checkins", "kiosk_checkins",
  "athlete_exercise_overrides", "body_weight_logs", "nutrition_checkin_suggestions", "client_goals", "client_macro_targets", "client_phase_plans",
  "session_exercise_videos", "transformation_milestones", "workout_notes", "workouts", "group_workout_exercises", "booking_waitlist_entries", "game_score_entries",
];
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

// What step 111 does to each name, shown as one check row per change in the precheck ("A + B -> final name"; the names listed must be in Ron's library).
const CATALOG_PREVIEW = [
  ["Back Squat + Barbell Back Squats -> Barbell Back Squat", ["Back Squat", "Barbell Back Squats"]],
  ["Front Squat + Barbell Front Squats -> Barbell Front Squat", ["Front Squat", "Barbell Front Squats"]],
  ["Leg Extension + Leg Extension Machine -> Leg Extension", ["Leg Extension", "Leg Extension Machine"]],
  ["Dumbbell Skull Crusher + Dumbbell Tricep Skull Crushers -> Dumbbell Skull Crusher", ["Dumbbell Skull Crusher", "Dumbbell Tricep Skull Crushers"]],
  ["Incline Dumbbell Bench Press + Incline Dumbbell Press -> Incline Dumbbell Bench Press", ["Incline Dumbbell Bench Press", "Incline Dumbbell Press"]],
  ["Single Arm Farmers Carry + Suitcase Carry (Single Arm Farmers Carry) -> Suitcase Carry", ["Single Arm Farmers Carry", "Suitcase Carry (Single Arm Farmers Carry)"]],
  ["Kettlebell Swing + Russian Kettlebell Swing -> Kettlebell Swing", ["Kettlebell Swing", "Russian Kettlebell Swing"]],
  ["Rear Foot Elevated Split Squat + Dumbbell Rear Foot Elevated Split Squat -> Dumbbell Rear Foot Elevated Split Squat", ["Rear Foot Elevated Split Squat", "Dumbbell Rear Foot Elevated Split Squat"]],
  ["Walking Lunge + Dumbbell Walking Lunge -> Dumbbell Walking Lunge", ["Walking Lunge", "Dumbbell Walking Lunge"]],
  ["Face Pull -> Banded Face Pull (stays separate from Cable Face Pull and Barbell Face Pull)", ["Face Pull"]],
  ["Cable Face Pulls -> Cable Face Pull", ["Cable Face Pulls"]],
  ["Romanian Deadlift -> Barbell Romanian Deadlift (Dumbbell Romanian Deadlift stays separate)", ["Romanian Deadlift", "Dumbbell Romanian Deadlift"]],
  ["Reverse Lunge -> Dumbbell Reverse Lunge (Barbell Reverse Lunge stays separate)", ["Reverse Lunge", "Barbell Reverse Lunge"]],
  ["Split Squat -> Dumbbell Split Squat", ["Split Squat"]],
  ["Box Squat -> Barbell Box Squat", ["Box Squat"]],
  ["Lat Pulldown -> Cable Lat Pulldown", ["Lat Pulldown"]],
];

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
    n: "52",
    slug: "0307",
    title: "0307 Release O fix: the target-change notice function is closed to the public and signed-in users like the other internal functions (it was left open by default; it is a trigger function so nobody could call it, but internal functions are server-only on purpose)",
    migrations: ["0307"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes: the notice still goes out when a coach applies a new target (the right to run a trigger function is checked when the trigger is made, not when it fires). Then run check-function-acl.sql: every row must say ok = true.",
    undo: "grant execute on function public.notify_on_target_change() to public;",
    undoWhy: "Only to diagnose. Puts back the default (anyone could run it, which does nothing useful since it only works as a trigger).",
    rows: [
      ["step 51 is applied (the notice function exists)", "exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace)"],
      ["0307 is not already applied (signed-in users can still run the notice function)", "coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'notify_on_target_change' and p.pronamespace = 'public'::regnamespace), false)"],
    ],
  },
  {
    n: "53",
    slug: "0308",
    title: "0308 Release O fix: every trigger function that signed-in users could run by default is closed to the public and signed-in users, like the other internal functions (" + TRIGGER_SWEEP.length + " functions; they can only ever run as triggers, and no trigger stops firing)",
    migrations: ["0308"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes: every notice, guard and calculation that runs when something is saved still runs (the right to run a trigger function is checked when the trigger is made, not when it fires). Then run check-function-acl.sql: every row must say ok = true (it now has a row for trigger functions).",
    undo: triggerSweepUndoSql(),
    undoWhy: "Only to diagnose. Gives signed-in users back the right to run each of them, exactly as it was before (the owner, signed-in users and the server).",
    rows: [
      ["the trigger functions exist (the database has its triggers)", "exists (select 1 from pg_proc where proname = 'guard_post_columns' and pronamespace = 'public'::regnamespace)"],
      ["0308 is not already applied (signed-in users can still run at least one of the trigger functions)", "exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any (array[" + TRIGGER_SWEEP.map((n) => "'" + n + "'").join(", ") + "]) and has_function_privilege('authenticated', p.oid, 'execute'))"],
    ],
  },
  {
    n: "62",
    slug: "0317",
    title: "0317 A package can include access to a group: one optional column on packages (the group it opens) and one server-only record of the access a package gave, so it can end cleanly when a subscription lapses",
    migrations: ["0317"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for existing packages (none has a group). A coach can now pick a group on a package; a client who buys or is given it joins that group and sees its programs. If a subscription ends, the group access ends; the program copy stays and sessions follow their own expiry rule.",
    undo: ["drop table if exists public.package_group_access;", "alter table public.coach_packages drop column if exists group_access_group_id;"].join(String.fromCharCode(10)),
    undoWhy: "Only if step 62 misbehaves. Removes the record and the column; clients already added to a group stay members of it.",
    rows: [
      ["coach_packages exists", has.table("coach_packages")],
      ["0317 is not already applied (packages have no group_access_group_id yet)", `not ${has.col("coach_packages", "group_access_group_id")}`],
    ],
  },
  {
    n: "61",
    slug: "0316",
    title: "0316 A program copy remembers which program it was copied from: one optional column (programs.source_program_id) and the copy function now stores it, so the builder can list the clients who hold a copy of a program",
    migrations: ["0316"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. Programs made before this keep no link (nothing is matched or renamed). From now on every copy (Assign to client, Duplicate, a package that carries a program) records the program it came from, and the program's label at the top of the builder lists the clients assigned to it.",
    undo: ["drop index if exists public.programs_source_program_id_idx;", "alter table public.programs drop column if exists source_program_id;", fnFromMigration("0310", "duplicate_program").split("' — '").join("' ' || chr(8212) || ' '"), "revoke execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) from public, anon;", "grant execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) to authenticated, service_role;"].join(String.fromCharCode(10)),
    undoWhy: "Only if step 61 misbehaves. Puts the copy function back exactly as it was (without storing the source) and removes the column; every program and copy stays.",
    rows: [
      ["the program copy function exists", has.fn("duplicate_program(uuid, uuid, uuid, uuid, text, date)")],
      ["0316 is not already applied (programs has no source_program_id yet)", `not ${has.col("programs", "source_program_id")}`],
    ],
  },
  {
    n: "68",
    slug: "0322",
    title: "0322 Deleting a client no longer fails because of a record they once created (an invite, for example): one server-only function clears everything that still points at the person, from the database's own list, and refuses only for shared records (a group or organization they own, billing, team records)",
    migrations: ["0322"],
    sees: "Success. No rows returned.",
    afterwards: "Deleting a client who once created an invite (or similar) now works. A person who owns a group or organization, or has billing or team records, is still refused with a plain message. Nothing changes until a client is deleted.",
    undo: [
      "drop function if exists public.detach_profile_references(uuid);",
      "drop function if exists public.profile_reference_unhandled();",
      "drop function if exists public.profile_blocking_links();",
      "drop function if exists public.profile_reference_policy();",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 68 misbehaves. Removes the four functions; the app then fails to delete a client who has such records, as before.",
    rows: [
      ["0322 is not already applied (the clearing function does not exist yet)", "to_regprocedure('public.detach_profile_references(uuid)') is null"],
    ],
  },
  {
    n: "67",
    slug: "0321",
    title: "0321 A coach's one short public website (My website): a private table for what the coach types, and a featured flag on Pro Shop cards (nothing is public until the coach publishes)",
    migrations: ["0321"],
    sees: "Success. No rows returned.",
    afterwards: "Business now has My website, where a coach fills in a few short fields and switches Publish on. Pro Shop cards can be marked Featured. Nothing is public until a coach publishes, and nothing changes for anyone until then.",
    undo: [
      "drop table if exists public.coach_sites;",
      "alter table public.pro_shop_links drop column if exists featured;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 67 misbehaves. Removes the website table (and anything coaches typed into it) and the featured flag.",
    rows: [
      ["0321 is not already applied (there is no coach_sites table yet)", "to_regclass('public.coach_sites') is null"],
    ],
  },
  {
    n: "66",
    slug: "0320",
    title: "0320 Image uploads work: the organization logo and app icon, the coach profile photo and the pro shop pictures were refused for everyone because their storage buckets had no rule for looking at a file's row (adds one rule per bucket, the same people who can already write)",
    migrations: ["0320"],
    sees: "Success. No rows returned.",
    afterwards: "Uploading an organization logo or app icon (Organization, Branding), a coach profile photo, or a pro shop picture now works for the person who owns it. Nobody gains the right to write anywhere new.",
    undo: [
      "drop policy if exists org_branding_select_owner_admin on storage.objects;",
      "drop policy if exists coach_profile_photos_select_own on storage.objects;",
      "drop policy if exists pro_shop_images_select_own on storage.objects;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 66 misbehaves. Removes the three new rules, which puts uploads back to how they were (refused).",
    rows: [
      ["0320 is not already applied (the organization logo bucket has no look rule yet)", "not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'org_branding_select_owner_admin')"],
    ],
  },
  {
    n: "65",
    slug: "0319",
    title: "0319 Three database functions are hardened: the two audit helpers get a fixed search path, and the database's own row-security helper (rls_auto_enable) is closed to signed-out visitors and signed-in users",
    migrations: ["0319"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. The database advisor stops warning about the two audit functions' search path, and rls_auto_enable can no longer be run through the public API (it still turns row security on for a new table, as before).",
    undo: [
      "alter function public.audit_log_refuse_changes() reset search_path;",
      "alter function public.audit_diff(jsonb, jsonb, text[]) reset search_path;",
      "do $u$ begin if to_regprocedure('public.rls_auto_enable()') is not null then execute 'grant execute on function public.rls_auto_enable() to public, anon, authenticated'; end if; end $u$;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 65 misbehaves. Takes the fixed search paths off the two audit functions and gives rls_auto_enable back to the public, signed-out visitors and signed-in users, exactly as before.",
    rows: [
      ["the audit functions exist (the audit trail is installed)", "to_regprocedure('public.audit_log_refuse_changes()') is not null and to_regprocedure('public.audit_diff(jsonb, jsonb, text[])') is not null"],
      ["0319 is not already applied (audit_diff has no fixed search path yet)", "exists (select 1 from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure and proconfig is null)"],
    ],
  },
  {
    n: "64",
    slug: "merge-duplicate-exercises",
    title: "merge Coach Ron's duplicate exercises into one entry each (13 duplicates into 12 survivors, Ron's library only; every set and log row is kept; undoable)",
    migrations: [],
    warn: "A one-time data change for Coach Ron's library ONLY. It rewrites the exercise name on his programs, his clients' sessions and records, his patterns, aliases and tags, saves the old duplicate names as aliases of the survivor, and deletes the duplicate library rows. Every changed or deleted row is saved first (exercise_merge_log, exercise_merge_deleted), and the undo file puts it all back. It refuses by itself if any of the 25 library entries is missing or if a name would clash.",
    sees: "Success. No rows returned.",
    afterwards: "Each duplicate (for example Deadlift and Conventional Deadlifts) is now Conventional Deadlift everywhere in Ron's programs and history, typing the old name still finds it (it is an alias), and the library lists each exercise once. To see how many rows changed per table: select tbl, col, count(*) from public.exercise_merge_log group by tbl, col order by tbl, col;",
    bodySql: readFileSync(new URL("./release-v-merge.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undo: readFileSync(new URL("./release-v-undo.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undoWhy: "Only if the merge is wrong. Puts every changed name back, brings the duplicate library rows back, removes the aliases the merge added, and drops the two log tables.",
    rows: [
      ["Coach Ron's profile exists", "exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')"],
      ["all 13 duplicate names are in Coach Ron's library", "(select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Deadlift', 'Conventional Deadlifts', 'Band Pull-Apart', 'Chin Ups', 'Dips', 'Dumbbell Lateral Raises', 'Farmer''s Carry', 'Lat Pull Down', 'Shoulder CARS', 'Sit Ups', 'Step Ups', 'Bulgarian Split Squats', 'Walking Lunges'])) = 13"],
      ["all 12 survivor names are in Coach Ron's library", "(select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Conventional Deadlift', 'Band Pull Apart', 'Chin-Up', 'Dip', 'Dumbbell Lateral Raise', 'Farmers Carry', 'Lat Pulldown', 'Shoulder CARs', 'Sit-Up', 'Step Up', 'Bulgarian Split Squat', 'Walking Lunge'])) = 12"],
      ["the 10 survivors that Ron's video is on still have a video", "(select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Conventional Deadlift', 'Band Pull Apart', 'Chin-Up', 'Dip', 'Dumbbell Lateral Raise', 'Farmers Carry', 'Lat Pulldown', 'Shoulder CARs', 'Sit-Up', 'Step Up']) and (video_path is not null or youtube_url is not null)) = 10"],
      ["step 64 is not already applied (the merge log is not there yet)", "to_regclass('public.exercise_merge_log') is null"],
    ],
  },
  {
    n: "63",
    slug: "0318",
    title: "0318 A program copy is named \"Program - Client\" without stacking: assigning a client's copy to someone else drops the old client's tail, and a name that already ends with this client gets nothing added (the copy function only; existing programs are not renamed)",
    migrations: ["0318"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes for existing programs (none is renamed). From now on assigning \"Base - Alice\" to Bob names the copy \"Base - Bob\", and assigning the same program to the same client twice no longer repeats the name.",
    undo: [fnFromMigration("0316", "duplicate_program"), "revoke execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) from public, anon;", "grant execute on function public.duplicate_program(uuid, uuid, uuid, uuid, text, date) to authenticated, service_role;"].join(String.fromCharCode(10)),
    undoWhy: "Only if step 63 misbehaves. Puts the copy function back exactly as step 61 left it (names stack again, as before).",
    rows: [
      ["the program copy function exists with the source link (step 61 is applied)", "exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace and position('ai_sequencing_notes, source_program_id' in prosrc) > 0)"],
      ["0318 is not already applied (the copy function does not strip a client tail yet)", "not exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace and position('v_tail' in prosrc) > 0)"],
    ],
  },
  {
    n: "60",
    slug: "0315",
    title: "0315 The \"I'm away\" preset reply: a coach writes one reply, turns it on (optionally with a last day), and every message a client sends them gets that reply back in the thread (marked as an auto-reply). One tiny private table, one marker column, two trigger functions",
    migrations: ["0315"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes until a coach turns it on in Messages. While it is on, each message a client sends gets the coach's reply (no limit: every message gets it), the coach still gets the usual notice for the client's message, and the thread shows a small 'Auto-reply' note on each reply that went out. It stops after the last day if one was set, or when the coach turns it off.",
    undo: [
      "drop trigger if exists direct_messages_send_away_reply on public.direct_messages;",
      "drop trigger if exists direct_messages_guard_auto_reply on public.direct_messages;",
      "drop function if exists public.send_away_reply();",
      "drop function if exists public.guard_direct_message_auto_reply();",
      "drop table if exists public.coach_away_replies;",
      "alter table public.direct_messages drop column if exists auto_reply;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 60 misbehaves. Removes the away setting, its two functions and the marker column; messages already sent stay as ordinary messages.",
    rows: [
      ["direct_messages exists (0140 is applied)", has.table("direct_messages")],
      ["0315 is not already applied (coach_away_replies is not there yet)", has.noTable("coach_away_replies")],
    ],
  },
  {
    n: "59",
    slug: "0314",
    title: "0314 \"Hide exercise demos\" follows the person, not the device: one tiny private table (client_ui_settings, one row per client, only that client can read or change it)",
    migrations: ["0314"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes until the code of the same release is live. After that a client who turns off exercise demos in Settings has them off on every phone and computer they sign in on; a client who never touched it sees demos as before.",
    undo: "drop table if exists public.client_ui_settings;",
    undoWhy: "Only if step 59 misbehaves. Removes the table; the switch then works on each device separately again, as before.",
    rows: [
      ["profiles exists", has.table("profiles")],
      ["0314 is not already applied (client_ui_settings is not there yet)", has.noTable("client_ui_settings")],
    ],
  },
  {
    n: "58",
    slug: "0313",
    title: "0313 Session counts worked out in the database for large rosters: one function (booking_counts) returns booked, to mark and prepaid-ahead per client and group, with a small index, so the pages that show \"8 left · 4 booked · 2 to mark\" stay fast and complete with 500+ clients",
    migrations: ["0313"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes: the same numbers appear on the Clients page, client profile and calendar. With the code of the same release live they are counted inside the database instead of by reading every open session, which is what keeps them working for a gym with hundreds of clients.",
    undo: ["drop function if exists public.booking_counts(uuid, uuid, uuid[], uuid);", "drop index if exists public.bookings_open_counts_idx;"].join("\n"),
    undoWhy: "Only if step 58 misbehaves. Removes the function and its index; the app then counts the old way (reading the open sessions), which is slower for very large rosters but gives the same numbers.",
    rows: [
      ["bookings exists", has.table("bookings")],
      ["0313 is not already applied (booking_counts is not there yet)", `not ${has.fnName("booking_counts")}`],
    ],
  },
  {
    n: "57",
    slug: "0312",
    title: "0312 A client booking or moving their own session must stay inside the coach's open hours and clear of time off: book_session and reschedule_booking now refuse any other time (a coach booking for a client is never refused)",
    migrations: ["0312"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use: the booking screens already only offer times inside the coach's hours. A direct call that tries to book or move a client's own session outside the coach's open hours, or onto time off, is now refused with 'that time is outside your coach's hours'. A coach scheduling a client is never refused.",
    undo: [fnFromMigration("0291", "book_session"), fnFromMigration("0291", "reschedule_booking")].join("\n"),
    undoWhy: "Only if booking misbehaves after step 57. Puts the two booking functions back as they were (without the open-hours check).",
    rows: [
      ["coach_time_is_open exists (0279 is applied)", has.fnName("coach_time_is_open")],
      ["0291 is applied (book_session checks that the coach coaches the group)", `coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false)`],
      ["0312 is not already applied (book_session does not check the hours yet)", `coalesce((select position('coach_time_is_open' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false)`],
    ],
  },
  {
    n: "56",
    slug: "0311",
    title: "0311 A client can ask for a different meal plan (up to 3 times per plan): a table of the tries with a copy of the plan from before each one, the server-only function that applies a try (counts the tries, refuses a 4th, never touches a day the coach built by hand, tells the coach in fixed wording), the coach's one-tap put-back function, and one notification type added to the list the database already has",
    migrations: ["0311"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes until the code of the same release is live. After that a client on a library-built meal plan sees a small box under their meals (\"Not feeling it? Tell us what to change.\"): they type what to change, the plan is rebuilt from the recipe library with no AI, and their coach gets a short bell line (\"Sam asked for a different meal plan (try 2 of 3).\") plus a \"Put back the plan from before\" button on the client's nutrition page. After the 3rd try the box says to message the coach instead.",
    undo: [
      "drop function if exists public.restore_meal_plan_try(uuid);",
      "drop function if exists public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text);",
      "drop function if exists public.meal_plan_try_number(text);",
      "drop table if exists public.meal_plan_tries;",
      "delete from public.notifications where type = 'meal_plan_try';",
      "do $undo$ declare v_def text; v_types text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; select array_agg(m[1] order by m[1]) into v_types from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'meal_plan_try'; alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_types) as t)); end $undo$;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 56 misbehaves. Removes the tries table (and the copies of earlier plans in it), the two functions, any try notices already sent, and the notification type. Plans already rebuilt for a client stay exactly as they are now (they are normal plans).",
    rows: [
      ["meal_plans, notifications and group_memberships exist", `${has.table("meal_plans")} and ${has.table("notifications")} and ${has.table("group_memberships")}`],
      ["is_group_coach exists", has.fnName("is_group_coach")],
      ["0311 is not already applied (the tries table is not there yet)", has.noTable("meal_plan_tries")],
    ],
  },
  {
    n: "55",
    slug: "0310",
    title: "0310 The coach's own name for an exercise: one new optional column on the program's exercises (display_name), set only when a coach picks an exercise through their own alias, and the program copy (Assign to client, Duplicate) carries it across. The real exercise name is untouched, so history, personal records and progression keep matching; only what is shown uses the coach's name",
    migrations: ["0310"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes until the code of the same release is live. After that, when a coach picks an exercise through one of their aliases (for example RFESS for the Bulgarian split squat) their program, the client's workout page and the logger show the coach's name, and every record and history lookup still uses the real exercise. Every existing exercise keeps showing exactly what it shows now.",
    undo: [
      "-- 1. the program copy goes back to the version from migration 0232 (it will no longer carry the coach's names)",
      migrationSql("0232").slice(migrationSql("0232").indexOf("create or replace function public.duplicate_program(")),
      "-- 2. the column and its length check",
      "alter table public.group_workout_exercises drop constraint if exists group_workout_exercises_display_name_len;",
      "alter table public.group_workout_exercises drop column if exists display_name;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 55 misbehaves. Puts the program copy back as it was, removes the column and any coach names already saved in it (the exercises themselves and all history are untouched; they simply show their real names again).",
    rows: [
      ["group_workout_exercises exists", has.table("group_workout_exercises")],
      ["the program copy function exists", has.fn("duplicate_program(uuid, uuid, uuid, uuid, text, date)")],
      ["0310 is not already applied (the display_name column is not there yet)", has.noCol("group_workout_exercises", "display_name")],
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
  {
    n: "44",
    slug: "0299",
    title: "0299 The record of what people agreed to (beta notice, terms, privacy, waiver) can only be added to: a trigger refuses any change to a row and any truncate, and the app's roles lose update, delete and truncate on it",
    migrations: ["0299"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone. Signing up, accepting a new version and the accept screen work exactly as before. What changes: no one, not even the server key, can edit or delete a row of legal_acceptances any more; deleting a person's account still removes their rows.",
    undo: [
      "drop trigger if exists legal_acceptances_no_truncate on public.legal_acceptances;",
      "drop trigger if exists legal_acceptances_append_only on public.legal_acceptances;",
      "drop function if exists public.legal_acceptances_refuse_changes();",
      "grant update, delete, truncate, references, trigger on public.legal_acceptances to anon, authenticated;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 44 gets in the way of something. Removes the two triggers and the function and gives the app's roles back the privileges they had before. No acceptance record is touched.",
    rows: [
      ["legal_acceptances exists (0255)", has.table("legal_acceptances")],
      ["0299 is not already applied (the append-only trigger is not there yet)", "not exists (select 1 from pg_trigger where tgname = 'legal_acceptances_append_only' and tgrelid = 'public.legal_acceptances'::regclass)"],
    ],
  },
  {
    n: "69",
    slug: "0323",
    title: "0323 Group events: a coach can add an event for one group (a monthly gym workout then lunch); members answer In or Out; it costs no session credit on any path, and the class functions now refuse an event",
    migrations: ["0323"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for classes or anyone's balance. The app can now create group events, post one announcement to the group's feed, and record In and Out answers. An event never takes, refunds or charges a session.",
    undo: [
      "update public.group_sessions set status = 'cancelled', cancelled_at = now() where kind = 'event' and status = 'scheduled';",
      "update public.bookings set status = 'cancelled' where id in (select anchor_booking_id from public.group_sessions where kind = 'event' and anchor_booking_id is not null) and status = 'confirmed';",
      "delete from public.group_sessions where kind = 'event';",
      "drop function if exists public.create_group_event(uuid, text, timestamptz, timestamptz, text, text, int);",
      "drop function if exists public.join_group_event(uuid, uuid);",
      "drop function if exists public.leave_group_event(uuid, uuid);",
      "drop function if exists public.cancel_group_event(uuid);",
      "drop function if exists public.mark_group_event_attendee(uuid, uuid, boolean);",
      fnFromMigration("0269", "join_group_session"),
      fnFromMigration("0263", "leave_group_session"),
      fnFromMigration("0269", "promote_group_waitlist"),
      fnFromMigration("0263", "set_group_session_capacity"),
      fnFromMigration("0263", "cancel_group_session"),
      fnFromMigration("0263", "mark_group_attendee"),
      fnFromMigration("0313", "booking_counts"),
      "drop policy if exists \"group_session_attendees_select_event_staff\" on public.group_session_attendees;",
      "drop policy if exists \"group_sessions_select_event_member\" on public.group_sessions;",
      "drop policy if exists \"group_sessions_select_client\" on public.group_sessions;",
      "create policy \"group_sessions_select_client\" on public.group_sessions for select to authenticated using (public.is_client_of_coach(coach_id));",
      "drop index if exists public.posts_group_session_idx;",
      "alter table public.posts drop column if exists group_session_id;",
      "drop index if exists public.group_sessions_group_start_idx;",
      "alter table public.group_sessions drop constraint if exists group_sessions_kind_shape;",
      "alter table public.group_sessions drop constraint if exists group_sessions_note_length;",
      "alter table public.group_sessions drop constraint if exists group_sessions_kind_check;",
      "alter table public.group_sessions alter column capacity set not null;",
      "alter table public.group_sessions drop column if exists note;",
      "alter table public.group_sessions drop column if exists group_id;",
      "alter table public.group_sessions drop column if exists kind;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 69 misbehaves. Cancels and removes any group events (and the feed posts that point at them), puts the class functions back exactly as they were, and drops the event functions and columns. Classes and balances are not touched.",
    rows: [
      ["0323 is not already applied (group_sessions has no kind column yet)", has.noCol("group_sessions", "kind")],
      ["the small-group session tables exist (0263)", has.table("group_sessions")],
      ["booking_counts exists (0313, step 58)", has.fnName("booking_counts")],
    ],
  },
  {
    n: "70",
    slug: "0324",
    title: "0324 AI builder safety: a program the AI builds is a draft (not active, and hidden from clients at the database level) until the coach signs it off; no path can make an unsigned draft live, and a copy of a draft is a draft",
    migrations: ["0324"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for any existing program. Programs the AI builds from now on are saved as drafts and only go live when the coach presses Sign off and make active.",
    undo: [
      // The read rules go back to their live text first (they use the two helper functions and the draft flag), then the helpers are dropped.
      'drop policy "exercise_progressions_select_members" on public.exercise_progressions;',
      'create policy "exercise_progressions_select_members" on public.exercise_progressions for select to authenticated using (public.is_group_member(group_id));',
      'drop policy "workout_notes_select_members" on public.workout_notes;',
      'create policy "workout_notes_select_members" on public.workout_notes for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)));',
      'drop policy "workouts_select_members" on public.workouts;',
      'create policy "workouts_select_members" on public.workouts for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)));',
      'drop policy "programs_select_members" on public.programs;',
      'create policy "programs_select_members" on public.programs for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)));',
      fnFromMigration("0128", "is_workout_visible_to_athlete"),
      "drop function if exists public.is_ai_draft_workout(uuid);",
      "drop function if exists public.is_ai_draft_program(uuid);",
      "drop trigger if exists programs_guard_ai_draft on public.programs;",
      "drop function if exists public.guard_ai_draft_not_active();",
      fnFromMigration("0318", "duplicate_program"),
      "alter table public.programs drop column if exists ai_draft;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 70 misbehaves. Puts the copy function back exactly as it was and drops the draft flag and its guard (any draft programs stay, now inactive or active as they were saved).",
    rows: [
      ["0324 is not already applied (programs has no ai_draft column yet)", has.noCol("programs", "ai_draft")],
      ["the program copy function exists (0318)", has.fnName("duplicate_program")],
    ],
  },
  {
    n: "71",
    slug: "0325",
    title: "0325 AI builder learning: the changes a coach makes to an AI draft are noted privately, one quiet question can be asked per pattern, and what the coach said Yes to is kept in one list they can undo",
    migrations: ["0325"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone. Four private tables and a snapshot column are added. From now on, signing off an AI draft notes what the coach changed, and after enough of the same change the coach is asked once.",
    undo: [
      "drop table if exists public.coach_learning_settings;",
      "drop table if exists public.coach_learned_rules;",
      "drop table if exists public.coach_edit_events;",
      "drop table if exists public.coach_program_signoffs;",
      "alter table public.programs drop column if exists ai_snapshot;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 71 misbehaves. Removes the four learning tables (and what they noted) and the snapshot column. The coach's standing preferences are not touched.",
    rows: [
      ["0325 is not already applied (programs has no ai_snapshot column yet)", has.noCol("programs", "ai_snapshot")],
      ["the AI draft flag exists (0324, step 70)", has.col("programs", "ai_draft")],
      ["the standing preferences table exists (0164)", has.table("coach_program_preferences")],
    ],
  },
  {
    n: "72",
    slug: "0326",
    title: "0326 AI builder conversation: an optional chapter-by-chapter conversation where the app asks the coach how they program; the invitation's state and the conversation are private to the coach",
    migrations: ["0326"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone. Two private tables and three invitation columns are added. Nothing is asked until the coach chooses to start.",
    undo: [
      "drop table if exists public.coach_conversation_messages;",
      "drop table if exists public.coach_conversations;",
      "alter table public.coach_learning_settings drop constraint if exists coach_learning_settings_invite_state_check;",
      "alter table public.coach_learning_settings drop column if exists invite_reminders;",
      "alter table public.coach_learning_settings drop column if exists invite_shown_at;",
      "alter table public.coach_learning_settings drop column if exists invite_state;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 72 misbehaves. Removes the two conversation tables (and what was said in them) and the invitation columns. Standing preferences the coach confirmed are not touched.",
    rows: [
      ["0326 is not already applied (coach_conversations does not exist yet)", has.noTable("coach_conversations")],
      ["the learning settings table exists (0325, step 71)", has.table("coach_learning_settings")],
    ],
  },
  {
    n: "73",
    slug: "0327",
    title: "0327 Coach message templates: a coach's own wording for the email that carries a client's sign-in link; private to the coach",
    migrations: ["0327"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone. One private table is added. Until a coach writes their own wording the app uses its default message.",
    undo: ["drop table if exists public.coach_message_templates;"].join(String.fromCharCode(10)),
    undoWhy: "Only if step 73 misbehaves. Removes the table (and any custom wording coaches saved); every coach goes back to the default message.",
    rows: [
      ["0327 is not already applied (coach_message_templates does not exist yet)", has.noTable("coach_message_templates")],
      ["profiles exists", has.table("profiles")],
    ],
  },
  {
    n: "74",
    slug: "0328",
    title: "0328 Remove a program from a client's profile without deleting it: programs.archived_at; a removed program is inactive and hidden from the client like an unsigned AI draft",
    migrations: ["0328"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone. One column is added. No program is hidden until a coach removes one from a client's profile.",
    undo: [
      "drop policy if exists \"programs_select_members\" on public.programs;",
      "create policy \"programs_select_members\" on public.programs for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)) and (is_group_coach(group_id) or (not ai_draft)));",
      "create or replace function public.is_ai_draft_program(_program_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select p.ai_draft from public.programs p where p.id = _program_id), false)';",
      "create or replace function public.is_ai_draft_workout(_workout_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select p.ai_draft from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false)';",
      "alter table public.programs drop constraint if exists programs_archived_is_inactive;",
      "alter table public.programs drop column if exists archived_at;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 74 misbehaves. Puts the two helper functions and the programs read rule back as they were and drops the column (programs that were removed from a profile become visible again to their clients).",
    rows: [
      ["0328 is not already applied (programs has no archived_at column yet)", has.noCol("programs", "archived_at")],
      ["the AI draft flag exists (0324, step 70)", has.col("programs", "ai_draft")],
    ],
  },
  {
    n: "75",
    slug: "0329",
    title: "0329 Release AA: every session costs exactly 1 credit (the session type's own cost is no longer read) and the waitlist offer shows the coach's time zone",
    migrations: ["0329"],
    sees: "Success. No rows returned.",
    afterwards: "Logging a workout for a client always uses exactly 1 session credit, whatever the session type. A waitlist offer now says the time on the coach's clock. Nothing else changes.",
    undo: [
      "alter table public.session_types drop constraint if exists session_types_credit_cost_is_one;",
      fnFromMigration("0236", "complete_workout_session"),
      fnFromMigration("0218", "offer_freed_slot_to_waitlist"),
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 75 misbehaves. Puts the two functions back to what they were (the session type's own cost is read again; the waitlist offer time is in UTC again) and removes the rule that a session type's cost must be 1.",
    rows: [
      ["0329 is not already applied (session_types has no cost-is-one rule yet)", "not exists (select 1 from pg_constraint where conname = 'session_types_credit_cost_is_one')"],
      ["no session type has a cost other than 1 (the rule could not be added otherwise)", "not exists (select 1 from public.session_types where credit_cost <> 1)"],
      ["complete_workout_session is the expected definition (locks the session and still reads the type's cost)", "exists (select 1 from pg_proc where proname = 'complete_workout_session' and pronamespace = 'public'::regnamespace and prosrc like '%for update%' and prosrc like '%select credit_cost into v_credit_cost%')"],
      ["offer_freed_slot_to_waitlist is the expected definition (still words the time in UTC)", "exists (select 1 from pg_proc where proname = 'offer_freed_slot_to_waitlist' and pronamespace = 'public'::regnamespace and prosrc like '%to_char(p_start_at, ''Dy Mon DD, HH12:MI AM'')%')"],
    ],
  },
  {
    n: "76",
    slug: "0330",
    title: "0330 Only a real coach can have a public booking page or a public website (the row-security rule for changing them now also requires coaching a group)",
    migrations: ["0330"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone who has a page (nobody does today). From now on an account that coaches no group cannot create or change a public page.",
    undo: [
      "drop policy if exists \"coach_booking_pages_coach_manage\" on public.coach_booking_pages;",
      "create policy \"coach_booking_pages_coach_manage\" on public.coach_booking_pages for all to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));",
      "drop policy if exists coach_sites_own on public.coach_sites;",
      "create policy coach_sites_own on public.coach_sites for all to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 76 misbehaves. Puts both rules back to 'your own row' (without the coaching check).",
    rows: [
      ["0330 is not already applied (the booking page rule does not mention coaching yet)", "not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage' and with_check like '%group_memberships%')"],
      ["both public page tables exist (0261, 0321)", "to_regclass('public.coach_booking_pages') is not null and to_regclass('public.coach_sites') is not null"],
      ["both rules are the expected ones (your own row only)", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_sites' and policyname = 'coach_sites_own')"],
    ],
  },
  {
    n: "77",
    slug: "0331",
    title: "0331 A paid session pack or membership renewal records its payment event and grants the sessions in ONE database step (a failed grant can no longer leave a handled-looking event with no sessions)",
    migrations: ["0331"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone today. Two server-only functions are added; the payment handler uses them once the new code is live.",
    undo: [
      "drop function if exists public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text);",
      "drop function if exists public.grant_subscription_credits_once(text, uuid, uuid, uuid, integer, text);",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 77 misbehaves. Removes the two functions. The payment handler of the new code needs them, so undo this only together with going back to the previous code.",
    rows: [
      ["0331 is not already applied (grant_purchase_once does not exist yet)", "to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is null"],
      ["the purchase tables exist", "to_regclass('public.credit_purchases') is not null and to_regclass('public.subscription_credit_grants') is not null"],
      ["the session ledger grant function exists (0248)", "to_regprocedure('public.grant_session_credits(uuid, uuid, integer, text, text)') is not null"],
    ],
  },
  {
    n: "78",
    slug: "0332",
    title: "0332 In a one-on-one space a program with no client on it is the coach's template: the client can no longer read it (nor its workouts, exercises or sets)",
    migrations: ["0332"],
    sees: "Success. No rows returned.",
    afterwards: "A client in a one-on-one space no longer sees a no-client program in that space (for example a template the coach copied there). Programs made for the client, team and social groups, and everything a coach sees are unchanged. One one-time change first: Karina Ramirez's \"4-Week Full-Body Strength Foundation\" and Johann Gorsik's \"3x_weekly_johann_program\" are attached to their own client (so each keeps seeing exactly what they see today). William Stafford's two \"Max anthony\" programs are not attached. No program is deleted.",
    undo: [
      "drop policy if exists \"programs_select_members\" on public.programs;",
      "create policy \"programs_select_members\" on public.programs for select to authenticated using (is_group_member(group_id) and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id)) and (is_group_coach(group_id) or (not ai_draft and archived_at is null)));",
      "create or replace function public.is_ai_draft_program(_program_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select (p.ai_draft or p.archived_at is not null) from public.programs p where p.id = _program_id), false)';",
      "create or replace function public.is_ai_draft_workout(_workout_id uuid) returns boolean language sql stable security definer set search_path = public as 'select coalesce((select (p.ai_draft or p.archived_at is not null) from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false)';",
      "drop function if exists public.is_one_on_one_group(uuid);",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 78 misbehaves. Puts the two helper functions and the programs read rule back as they were after step 74 (clients in a one-on-one space can read no-client programs there again). It does not un-attach Karina's and Johann's programs from their clients; that is harmless.",
    rows: [
      ["0332 is not already applied (is_one_on_one_group does not exist yet)", "to_regprocedure('public.is_one_on_one_group(uuid)') is null"],
      ["programs can be removed from a profile (0328, step 74 applied)", has.col("programs", "archived_at")],
      ["the two helper functions are the 0328 versions (they mention archived_at)", "exists (select 1 from pg_proc where proname = 'is_ai_draft_program' and pronamespace = 'public'::regnamespace and prosrc like '%archived_at%') and exists (select 1 from pg_proc where proname = 'is_ai_draft_workout' and pronamespace = 'public'::regnamespace and prosrc like '%archived_at%')"],
    ],
  },
  {
    n: "79",
    slug: "0333",
    title: "0333 A one-on-one space keeps being one: its programs must be for its client, group-only features are refused there, and it cannot be turned into another kind of space",
    migrations: ["0333"],
    sees: "Success. No rows returned.",
    afterwards: "A new program in a one-on-one space with no client on it is filled in with the space's one client (or refused if there is not exactly one). Group events, invite links, team games, practice schedules and stat categories cannot be added to a one-on-one space. A one-on-one space cannot be switched to another kind, and moving a client into a one-on-one space that already has its client now says so plainly. Programs already there (including ones with no client on them) are not changed or deleted and can still be renamed, copied or deleted.",
    undo: [
      "drop trigger if exists programs_guard_one_on_one on public.programs;\ndrop trigger if exists group_sessions_no_events_one_on_one on public.group_sessions;\ndrop trigger if exists group_invites_no_one_on_one on public.group_invites;\ndrop trigger if exists team_games_no_one_on_one on public.team_games;\ndrop trigger if exists team_practice_schedules_no_one_on_one on public.team_practice_schedules;\ndrop trigger if exists group_stat_fields_no_one_on_one on public.group_stat_fields;\ndrop function if exists public.guard_one_on_one_program();\ndrop function if exists public.refuse_in_one_on_one();\ndrop function if exists public.refuse_event_in_one_on_one();\ndrop function if exists public.one_on_one_athlete(uuid);",
      fnFromMigration("0273", "guard_group_columns"),
      readFileSync(new URL("./release-ak-undo-move-client.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 79 misbehaves. Removes the new rules and puts guard_group_columns and move_client_to_group back exactly as they were (clients can again be added to, and spaces switched away from, one-on-one without these checks).",
    rows: [
      ["0333 is not already applied (one_on_one_athlete does not exist yet)", "to_regprocedure('public.one_on_one_athlete(uuid)') is null"],
      ["0332 is applied (step 78): is_one_on_one_group exists", "to_regprocedure('public.is_one_on_one_group(uuid)') is not null"],
      ["guard_group_columns is the live 0273 text (so replacing it loses nothing)", "(select md5(replace(prosrc, chr(13), '')) from pg_proc where proname = 'guard_group_columns' and pronamespace = 'public'::regnamespace) = 'cea7182706ddecddad86da2d710c6b4e'"],
      ["move_client_to_group is the live text, or the 0106 text (they differ only in a comment), so replacing it loses nothing", "(select md5(replace(prosrc, chr(13), '')) from pg_proc where proname = 'move_client_to_group' and pronamespace = 'public'::regnamespace) in ('d22c15df46986728f97a0b9e445b87b1', '3425f2a00e3b4e44cba31f5213ea5f8c')"],
      ["the tables the new rules sit on exist", "to_regclass('public.group_sessions') is not null and to_regclass('public.group_invites') is not null and to_regclass('public.team_games') is not null and to_regclass('public.team_practice_schedules') is not null and to_regclass('public.group_stat_fields') is not null"],
    ],
  },
  {
    n: "80",
    slug: "0334",
    title: "0334 A client can choose whether their first name is shown on their shared workout pictures (on for everyone until they switch it off)",
    migrations: ["0334"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for anyone until a client switches it off in their own Settings. Everyone's first name keeps showing on their shared workout pictures, as it does now.",
    undo: "alter table public.profiles drop column if exists show_name_on_share;",
    undoWhy: "Only if step 80 misbehaves. Removes the new column (every client's name shows on shared pictures again, whatever they chose).",
    rows: [
      ["0334 is not already applied (profiles has no show_name_on_share yet)", "not " + has.col("profiles", "show_name_on_share")],
      ["profiles has the earlier share-picture column (0197)", has.col("profiles", "preferred_share_background")],
    ],
  },
  {
    n: "81",
    slug: "0335",
    title: "0335 Assigning a program that belongs to no client to ONE client attaches it to that client (no copy is left behind)",
    migrations: ["0335"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes by itself. After the app update, assigning a template (a program with no client on it, nobody has used) to one client makes it that client's program instead of making a copy and leaving the original in the library. Any other assignment copies, as before.",
    undo: "drop function if exists public.assign_program_to_client(uuid, uuid, uuid, text, date);",
    undoWhy: "Only if step 81 misbehaves. Removes the new function (assigning then always makes a copy, as before). Nothing already assigned changes.",
    rows: [
      ["0335 is not already applied (assign_program_to_client does not exist yet)", "to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is null"],
      ["the program copy function exists", has.fn("duplicate_program(uuid, uuid, uuid, uuid, text, date)")],
      ["programs can be removed from a profile (archived_at exists, 0328)", has.col("programs", "archived_at")],
      ["the tables the attach checks exist", "to_regclass('public.workout_logs') is not null and to_regclass('public.athlete_sessions') is not null and to_regclass('public.workout_assignments') is not null and to_regclass('public.challenges') is not null and to_regclass('public.exercise_progressions') is not null"],
    ],
  },
  {
    n: "82",
    slug: "0336",
    title: "0336 The 'What do you call your people?' card is asked once, for good (remembered on the coach's profile; every coach already here counts as answered)",
    migrations: ["0336"],
    sees: "Success. No rows returned.",
    afterwards: "Every coach who is already in the app is marked as having answered, so none of them see the card again, and it no longer comes back on a new browser or device. A coach who joins later is asked once.",
    undo: "alter table public.profiles drop column if exists terminology_asked_at;",
    undoWhy: "Only if step 82 misbehaves. Removes the column (the card goes back to being remembered by each browser only).",
    rows: [
      ["0336 is not already applied (profiles has no terminology_asked_at yet)", has.noCol("profiles", "terminology_asked_at")],
      ["coaches are recorded in group_memberships", has.col("group_memberships", "role")],
    ],
  },
  {
    n: "83",
    slug: "0337",
    title: "0337 Assigning a program attaches it only inside one organization (across organizations it makes a copy)",
    migrations: ["0337"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. A coach who belongs to two organizations can no longer move an unused library program out of one organization into a client's space in the other; assigning across organizations makes a copy and leaves the original where it is.",
    undo: [
      fnFromMigration("0335", "assign_program_to_client"),
      "revoke execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) from public, anon;",
      "grant execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) to authenticated, service_role;",
    ].join("\n"),
    undoWhy: "Only if step 83 misbehaves. Puts back the earlier version of the function (it then attaches whatever the earlier rules allow, in any organization).",
    rows: [
      ["0337 is not already applied (the function does not yet compare organizations)", "to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null and position('v_src_org' in pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)'))) = 0"],
      ["the assign function from 0335 exists", "to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null"],
      ["groups have an organization_id", has.col("groups", "organization_id")],
    ],
  },
  {
    n: "84",
    slug: "0338",
    title: "0338 A parent-view link can only be made for a client under 13 in a group the coach coaches, and it expires; three internal training-partner functions are closed to the browser",
    migrations: ["0338"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. Parent-view links that are live today keep working for 90 days. A coach can no longer make a link for someone who is not an under-13 client in one of their own groups, and every new link stops working after 90 days. Matching of training partners behaves exactly as before.",
    undo: [
      'drop policy if exists "guardian_links_coach_select" on public.guardian_links;',
      'drop policy if exists "guardian_links_coach_insert" on public.guardian_links;',
      'drop policy if exists "guardian_links_coach_update" on public.guardian_links;',
      'drop policy if exists "guardian_links_coach_delete" on public.guardian_links;',
      'drop policy if exists "guardian_links_coach_manage" on public.guardian_links;',
      'create policy "guardian_links_coach_manage" on public.guardian_links for all to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));',
      "grant update on public.guardian_links to authenticated;",
      "drop function if exists public.guardian_link_allowed(uuid, uuid);",
      "alter table public.guardian_links drop column if exists expires_at;",
      "grant execute on function public.training_partner_is_minor(uuid) to public, anon, authenticated;",
      "grant execute on function public.training_partner_intake_incomplete(uuid) to public, anon, authenticated;",
      "grant execute on function public.training_partner_org_restricted(uuid) to public, anon, authenticated;",
    ].join("\n"),
    undoWhy: "Only if step 84 misbehaves. Puts back the old single parent-link rule (any coach of the group, no age check) and opens the three training-partner functions again as they were. The links lose their expiry date.",
    rows: [
      ["0338 is not already applied (guardian_links has no expires_at yet)", has.noCol("guardian_links", "expires_at")],
      ["the old parent-link rule is still there", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'guardian_links' and policyname = 'guardian_links_coach_manage')"],
      ["the group-coach check and the date of birth column exist", has.fn("is_group_coach(uuid)") + " and " + has.col("client_intake", "date_of_birth")],
      ["the three training-partner functions exist", has.fn("training_partner_is_minor(uuid)") + " and " + has.fn("training_partner_intake_incomplete(uuid)") + " and " + has.fn("training_partner_org_restricted(uuid)") + " and " + has.fn("training_partner_is_restricted(uuid)")],
    ],
  },
  {
    n: "85",
    slug: "0339",
    title: "0339 A transformation card can only use the athlete's own photos and milestone, in a group they are a client of, and is never made for a client under 18",
    migrations: ["0339"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. Cards that already exist are untouched. A card can no longer be saved with someone else's photo or a group the person is not a client of, and cannot be made for a client under 18.",
    undo: [
      'drop policy if exists "transformation_cards_insert_own" on public.transformation_cards;',
      'drop policy if exists "transformation_cards_update_own" on public.transformation_cards;',
      'drop policy if exists "transformation_cards_delete_own" on public.transformation_cards;',
      'drop policy if exists "transformation_cards_write_own" on public.transformation_cards;',
      'create policy "transformation_cards_write_own" on public.transformation_cards for all to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));',
    ].join("\n"),
    undoWhy: "Only if step 85 misbehaves. Puts back the earlier single rule (an athlete can write their own cards, with no check on the photo or group).",
    rows: [
      ["0339 is not already applied (the new insert rule is absent)", "not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own')"],
      ["the earlier card write rule is in place", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_write_own')"],
      ["the tables the new rule checks exist", "to_regclass('public.progress_photos') is not null and to_regclass('public.transformation_milestones') is not null and to_regclass('public.client_intake') is not null"],
    ],
  },
  {
    n: "86",
    slug: "0340",
    title: "0340 A coach can only file a row about a person who belongs to that group (one rule on 28 tables); a client can only be moved inside one organization; an organization admin can't add themselves to a private client's space; a comment stays in its post's group",
    migrations: ["0340"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. A coach (or anyone signed in) can no longer save a macro target, meal plan, consent record, booking, program, workout assignment, check-in, session or similar row for a person who is not in the group it is filed under. A client can only be moved between groups of the same organization. Rows that already exist are untouched.",
    undo: [
      ...TENANT_TABLES.map((t) => `drop trigger if exists ${t}_enforce_athlete_in_group on public.${t};`),
      // tables made after this step (the InBody scans) carry the same rule: take it off wherever it is, so the function can go
      "do $undo$ declare r record; begin for r in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgfoid = 'public.enforce_athlete_in_group'::regproc and not t.tgisinternal loop execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname); end loop; end $undo$;",
      "drop function if exists public.enforce_athlete_in_group();",
      "drop trigger if exists group_memberships_guard_org_move on public.group_memberships;",
      "drop function if exists public.guard_membership_org_move();",
      fnFromMigration("0333", "move_client_to_group"),
      'drop policy if exists "memberships_insert_coach_or_self" on public.group_memberships;',
      'create policy "memberships_insert_coach_or_self" on public.group_memberships for insert to authenticated with check ((public.is_group_coach(group_id) and (profile_id = (select auth.uid()) or public.is_coach_of_athlete(profile_id))) or (profile_id = (select auth.uid()) and role = \'coach\' and public.is_org_admin_of_group(group_id)));',
      "drop function if exists public.group_closed_to_org_admin_join(uuid);",
      'drop policy if exists "comments_insert_members" on public.comments;',
      'create policy "comments_insert_members" on public.comments for insert to authenticated with check (author_id = (select auth.uid()) and public.is_group_member(group_id));',
      'drop policy if exists "comments_update_own" on public.comments;',
      'create policy "comments_update_own" on public.comments for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));',
    ].join("\n"),
    undoWhy: "Only if step 86 misbehaves (for example a coach is told 'That person is not a member of this group' for a client who really is in the group). Removes the rule from all 28 tables and puts back the earlier move, membership and comment rules.",
    rows: [
      ["0340 is not already applied (the rule function does not exist yet)", "to_regprocedure('public.enforce_athlete_in_group()') is null"],
      ["the helpers the new rules use exist", has.fn("is_group_member(uuid)") + " and " + has.fn("is_one_on_one_group(uuid)") + " and " + has.fn("is_org_admin_of_group(uuid)") + " and " + has.fn("is_coach_of_athlete(uuid)") + " and " + has.fn("move_client_to_group(uuid, uuid, uuid)")],
      ["groups have an organization and memberships can be private from it", has.col("groups", "organization_id") + " and " + has.col("group_memberships", "private_from_org")],
      ["every table the rule covers has the person and group columns", TENANT_TABLES.map((t) => has.col(t, "athlete_id") + " and " + has.col(t, "group_id")).join(" and ")],
    ],
  },
  {
    n: "87",
    slug: "0341",
    title: "0341 A coach package can only be created, changed or removed by the server (a client could file their own package with thousands of sessions and pay for a cheap one)",
    migrations: ["0341"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use: the packages screen already saves through the server. Nobody can write the packages table straight from a browser any more. Reading is unchanged and existing packages are untouched.",
    undo: [
      'create policy "coach_packages_insert_coach" on public.coach_packages for insert to authenticated with check (coach_id = (select auth.uid()));',
      'create policy "coach_packages_update_coach" on public.coach_packages for update to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));',
      'create policy "coach_packages_delete_coach" on public.coach_packages for delete to authenticated using (coach_id = (select auth.uid()));',
    ].join("\n"),
    undoWhy: "Only if step 87 misbehaves (for example the packages screen can no longer save). Puts back the three write rules exactly as they were.",
    rows: [
      ["0341 is not already applied (the old write rules are still there)", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach')"],
      ["the update and delete rules are still there too", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_update_coach') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_delete_coach')"],
      ["the packages table has its group and session columns", has.col("coach_packages", "group_id") + " and " + has.col("coach_packages", "sessions_granted")],
    ],
  },
  {
    n: "88",
    slug: "0342",
    title: "0342 Private lookups the row rules use can't be asked about other people by any signed-in account (who shares an organization, who blocked whom, who is a client of a group, who is hidden from the organization, a coach's client count)",
    migrations: ["0342"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use: the app's own rules ask these questions only about the signed-in person. Anyone else asking about other people now gets 'no'. The server and the database's own jobs are unaffected.",
    undo: ["create or replace function public.training_partners_share_org(a uuid, b uuid) returns boolean language sql stable security definer set search_path to 'public' as $function$ select exists (select 1 from public.group_memberships gm_a join public.groups g_a on g_a.id = gm_a.group_id join public.group_memberships gm_b on gm_b.profile_id = b join public.groups g_b on g_b.id = gm_b.group_id where gm_a.profile_id = a and g_a.organization_id is not null and g_b.organization_id = g_a.organization_id); $function$;","create or replace function public.training_partners_mutually_blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path to 'public' as $function$ select exists (select 1 from public.training_partner_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)); $function$;","create or replace function public.is_training_client_of_group(_group_id uuid, _athlete_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path to 'public' as $function$ select exists (select 1 from public.group_memberships where group_id = _group_id and profile_id = _athlete_id and role = 'athlete' and membership_type = 'training'); $function$;","create or replace function public.is_client_private_from_org(_group_id uuid, _athlete_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $function$ select coalesce((select private_from_org from public.group_memberships where group_id = _group_id and profile_id = _athlete_id), false); $function$;","create or replace function public.is_wearable_subject_private_from_org(_profile_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $function$ select exists (select 1 from public.group_memberships where profile_id = _profile_id and private_from_org = true); $function$;","grant execute on function public.coach_ai_multiplier(uuid) to public, anon, authenticated;","grant execute on function public.coach_client_steps(uuid) to public, anon, authenticated;"].join("\n"),
    undoWhy: "Only if step 88 misbehaves (for example an organization admin can no longer see a client they should, or training-partner matching stops listing people). Puts the five functions back exactly as they were and opens the two coach-count functions to signed-in users again.",
    rows: [
      ["0342 is not already applied (the coach-count function can still be run by a signed-in user)", "has_function_privilege('authenticated', 'public.coach_ai_multiplier(uuid)', 'execute')"],
      ["the five functions exist", has.fn("training_partners_share_org(uuid, uuid)") + " and " + has.fn("training_partners_mutually_blocked(uuid, uuid)") + " and " + has.fn("is_training_client_of_group(uuid, uuid)") + " and " + has.fn("is_client_private_from_org(uuid, uuid)") + " and " + has.fn("is_wearable_subject_private_from_org(uuid)")],
      ["the helpers they now call exist", has.fn("is_group_coach(uuid)") + " and " + has.fn("is_org_admin_of_group(uuid)") + " and " + has.fn("is_platform_admin()")],
      ["the two coach-count functions exist", has.fn("coach_ai_multiplier(uuid)") + " and " + has.fn("coach_client_steps(uuid)")],
    ],
  },
  {
    n: "89",
    slug: "0343",
    title: "0343 A coach's credit pack or Lift Off grant is recorded and added in one step (a failed add is retried instead of lost)",
    migrations: ["0343"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes. Two new server-only functions exist. After the app update, a coach who pays for a credit pack or a Lift Off month always gets the credits, even if the first attempt hit a database error. Run this paste BEFORE the code that uses it deploys; until the code deploys nothing uses it.",
    undo: [
      "drop function if exists public.grant_coach_credit_pack_once(text, text, uuid, integer, integer);",
      "drop function if exists public.grant_lift_off_credits_once(text, uuid, integer);",
    ].join("\n"),
    undoWhy: "Only if step 89 misbehaves. Removes the two functions. Do NOT undo after the new app code is live (it would then fail to grant credits); undo only before, or deploy the previous code first.",
    rows: [
      ["0343 is not already applied (the credit-pack function does not exist yet)", "to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is null"],
      ["the credit adjust function and both record tables exist", has.fn("adjust_coach_credits(uuid, integer)") + " and to_regclass('public.coach_credit_purchases') is not null and to_regclass('public.lift_off_credit_grants') is not null"],
    ],
  },
  {
    n: "90",
    slug: "0344",
    title: "0344 The 'person must belong to the group' rule still lets a coach tidy up an existing row of someone who has since left (refunds and settlements)",
    migrations: ["0344"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use. A coach refunding or settling a session for a client who has since left the group no longer gets 'That person is not a member of this group'. A first row about someone who never belonged to the group is still refused. Run AFTER Release AR.",
    undo: fnFromMigration("0340", "enforce_athlete_in_group"),
    undoWhy: "Only if step 90 misbehaves. Puts back the first version of the rule (no exception for existing rows).",
    rows: [
      ["0344 is not already applied (the rule has no exception for existing rows yet)", "to_regprocedure('public.enforce_athlete_in_group()') is not null and position('v_had_row' in pg_get_functiondef(to_regprocedure('public.enforce_athlete_in_group()'))) = 0"],
      ["Release AR is applied (the rule exists)", "to_regprocedure('public.enforce_athlete_in_group()') is not null"],
    ],
  },
  {
    n: "91",
    slug: "0345",
    title: "0345 The organization walls: a person can only see names of people they share a group with (or, for an owner or admin, everyone in their organization); a platform administrator can no longer read client content; who has which tag is limited to the owner, admins and that client's coach",
    migrations: ["0345"],
    sees: "Success. No rows returned.",
    afterwards: "Names: a coach sees their own clients and the owner or admins of their organization, a client sees their coach, the owner and their team, the owner of an organization sees everyone in it, and nobody sees a person from another organization. Old records of a client who left a group still show their name to the coach who had them. The platform administrator account no longer reads workout sessions, sets, program exercises, feed posts or wearable data of organizations it is not in. Nothing is deleted. Run this AFTER the code that goes with it is live (the code never relies on seeing a stranger's name).",
    undo: ["drop policy if exists \"profiles_select_visible\" on public.profiles;","create policy \"profiles_select_authenticated\" on public.profiles for select to authenticated using (true);","drop policy if exists \"sessions_select_own_or_coach\" on public.athlete_sessions;","create policy \"sessions_select_own_or_coach\" on public.athlete_sessions for select to authenticated using (((athlete_id = ( SELECT auth.uid() AS uid)) OR is_group_coach(group_id) OR ((is_org_admin_of_group(group_id) OR is_platform_admin()) AND (NOT is_client_private_from_org(group_id, athlete_id)))));","drop policy if exists \"coach_briefing_items_select_assigned_or_cascade\" on public.coach_briefing_items;","create policy \"coach_briefing_items_select_assigned_or_cascade\" on public.coach_briefing_items for select to authenticated using ((is_group_coach(group_id) OR ((NOT is_client_private_from_org(group_id, athlete_id)) AND (is_org_admin_of_group(group_id) OR is_platform_admin()))));","drop policy if exists \"gwes_select_members\" on public.group_workout_exercise_sets;","create policy \"gwes_select_members\" on public.group_workout_exercise_sets for select to authenticated using ((EXISTS ( SELECT 1 FROM group_workout_exercises g WHERE ((g.id = group_workout_exercise_sets.group_workout_exercise_id) AND ((is_group_member(g.group_id) AND ((g.athlete_id IS NULL) OR (g.athlete_id = ( SELECT auth.uid() AS uid)) OR is_group_coach(g.group_id)) AND (is_group_coach(g.group_id) OR is_workout_visible_to_athlete(g.workout_id))) OR ((is_org_admin_of_group(g.group_id) OR is_platform_admin()) AND ((g.athlete_id IS NULL) OR (NOT is_client_private_from_org(g.group_id, g.athlete_id)))))))));","drop policy if exists \"gwe_select_members\" on public.group_workout_exercises;","create policy \"gwe_select_members\" on public.group_workout_exercises for select to authenticated using (((is_group_member(group_id) AND ((athlete_id IS NULL) OR (athlete_id = ( SELECT auth.uid() AS uid)) OR is_group_coach(group_id)) AND (is_group_coach(group_id) OR is_workout_visible_to_athlete(workout_id))) OR ((is_org_admin_of_group(group_id) OR is_platform_admin()) AND ((athlete_id IS NULL) OR (NOT is_client_private_from_org(group_id, athlete_id))))));","drop policy if exists \"posts_select_members\" on public.posts;","create policy \"posts_select_members\" on public.posts for select to authenticated using ((is_group_member(group_id) OR is_org_admin_of_group(group_id) OR is_platform_admin()));","drop policy if exists \"posts_delete_own_or_coach\" on public.posts;","create policy \"posts_delete_own_or_coach\" on public.posts for delete to authenticated using (((author_id = ( SELECT auth.uid() AS uid)) OR is_group_coach(group_id) OR is_org_admin_of_group(group_id) OR is_platform_admin()));","drop policy if exists \"session_exercises_select_own_or_coach\" on public.session_exercises;","create policy \"session_exercises_select_own_or_coach\" on public.session_exercises for select to authenticated using ((EXISTS ( SELECT 1 FROM athlete_sessions s WHERE ((s.id = session_exercises.session_id) AND ((s.athlete_id = ( SELECT auth.uid() AS uid)) OR is_group_coach(s.group_id) OR ((is_org_admin_of_group(s.group_id) OR is_platform_admin()) AND (NOT is_client_private_from_org(s.group_id, s.athlete_id))))))));","drop policy if exists \"set_logs_select_own_or_coach\" on public.set_logs;","create policy \"set_logs_select_own_or_coach\" on public.set_logs for select to authenticated using ((EXISTS ( SELECT 1 FROM (session_exercises se JOIN athlete_sessions s ON ((s.id = se.session_id))) WHERE ((se.id = set_logs.session_exercise_id) AND ((s.athlete_id = ( SELECT auth.uid() AS uid)) OR is_group_coach(s.group_id) OR ((is_org_admin_of_group(s.group_id) OR is_platform_admin()) AND (NOT is_client_private_from_org(s.group_id, s.athlete_id))))))));","drop policy if exists \"wearable_connections_select_own_or_coach\" on public.wearable_connections;","create policy \"wearable_connections_select_own_or_coach\" on public.wearable_connections for select to authenticated using ((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM (group_memberships gm_self JOIN group_memberships gm_target ON ((gm_target.group_id = gm_self.group_id))) WHERE ((gm_self.profile_id = ( SELECT auth.uid() AS uid)) AND (gm_self.role = 'coach'::member_role) AND (gm_target.profile_id = wearable_connections.profile_id)))) OR ((NOT is_wearable_subject_private_from_org(profile_id)) AND ((EXISTS ( SELECT 1 FROM ((group_memberships gm_target JOIN groups g ON ((g.id = gm_target.group_id))) JOIN organization_memberships om ON ((om.organization_id = g.organization_id))) WHERE ((gm_target.profile_id = wearable_connections.profile_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.role = ANY (ARRAY['owner'::org_member_role, 'admin'::org_member_role]))))) OR is_platform_admin())));","drop policy if exists \"wearable_daily_metrics_select_own_or_coach\" on public.wearable_daily_metrics;","create policy \"wearable_daily_metrics_select_own_or_coach\" on public.wearable_daily_metrics for select to authenticated using ((EXISTS ( SELECT 1 FROM wearable_connections c WHERE ((c.id = wearable_daily_metrics.connection_id) AND ((c.profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM (group_memberships gm_self JOIN group_memberships gm_target ON ((gm_target.group_id = gm_self.group_id))) WHERE ((gm_self.profile_id = ( SELECT auth.uid() AS uid)) AND (gm_self.role = 'coach'::member_role) AND (gm_target.profile_id = c.profile_id)))) OR ((NOT is_wearable_subject_private_from_org(c.profile_id)) AND ((EXISTS ( SELECT 1 FROM ((group_memberships gm_target JOIN groups g ON ((g.id = gm_target.group_id))) JOIN organization_memberships om ON ((om.organization_id = g.organization_id))) WHERE ((gm_target.profile_id = c.profile_id) AND (om.profile_id = ( SELECT auth.uid() AS uid)) AND (om.role = ANY (ARRAY['owner'::org_member_role, 'admin'::org_member_role]))))) OR is_platform_admin())))))));","drop policy if exists \"client_tag_assignments_select_org_member\" on public.client_tag_assignments;","create policy \"client_tag_assignments_select_org_member\" on public.client_tag_assignments for select to authenticated using ((EXISTS ( SELECT 1 FROM client_tags t WHERE ((t.id = client_tag_assignments.tag_id) AND is_org_member(t.organization_id)))));","drop policy if exists \"programs_select_org_owner\" on public.programs;","drop policy if exists \"workouts_select_org_owner\" on public.workouts;","drop policy if exists \"coach_packages_select_org_owner\" on public.coach_packages;","drop policy if exists \"bookings_select_org_owner\" on public.bookings;","drop policy if exists \"session_credits_select_org_owner\" on public.session_credits;","drop policy if exists \"session_credit_ledger_select_org_owner\" on public.session_credit_ledger;","drop policy if exists \"credit_purchases_select_org_owner\" on public.credit_purchases;","drop policy if exists \"membership_subscriptions_select_org_owner\" on public.membership_subscriptions;","drop policy if exists \"coach_quick_payments_select_org_owner\" on public.coach_quick_payments;","drop policy if exists \"workout_logs_select_org_owner\" on public.workout_logs;","drop policy if exists \"group_memberships_select_org_owner\" on public.group_memberships;","drop policy if exists \"athlete_notes_select_org_owner\" on public.athlete_notes;","drop policy if exists \"client_intake_select_org_owner\" on public.client_intake;","drop policy if exists \"daily_macros_select_org_owner\" on public.daily_macros;","drop policy if exists \"meal_plans_select_org_owner\" on public.meal_plans;","drop policy if exists \"food_log_entries_select_org_owner\" on public.food_log_entries;","drop policy if exists \"client_macro_targets_select_org_owner\" on public.client_macro_targets;","drop policy if exists \"client_macro_target_history_select_org_owner\" on public.client_macro_target_history;","drop policy if exists \"nutrition_checkins_select_org_owner\" on public.nutrition_checkins;","drop policy if exists \"nutrition_phases_select_org_owner\" on public.nutrition_phases;","drop policy if exists \"client_phase_plans_select_org_owner\" on public.client_phase_plans;","drop policy if exists \"nutrition_checkin_suggestions_select_org_owner\" on public.nutrition_checkin_suggestions;","drop policy if exists \"direct_messages_select_org_owner\" on public.direct_messages;","drop policy if exists \"training_partner_profiles_select_visible\" on public.training_partner_profiles;","create policy \"training_partner_profiles_select_visible\" on public.training_partner_profiles for select to authenticated using (((visible = true) AND (NOT training_partners_mutually_blocked(athlete_id, ( SELECT auth.uid() AS uid))) AND (training_partners_share_org(athlete_id, ( SELECT auth.uid() AS uid)) OR ((NOT training_partner_is_restricted(athlete_id)) AND (NOT training_partner_is_restricted(( SELECT auth.uid() AS uid)))))));","drop policy if exists \"training_partner_requests_insert_own\" on public.training_partner_requests;","create policy \"training_partner_requests_insert_own\" on public.training_partner_requests for insert to authenticated with check (((from_athlete_id = ( SELECT auth.uid() AS uid)) AND (NOT training_partners_mutually_blocked(to_athlete_id, ( SELECT auth.uid() AS uid))) AND (training_partners_share_org(to_athlete_id, ( SELECT auth.uid() AS uid)) OR ((NOT training_partner_is_restricted(to_athlete_id)) AND (NOT training_partner_is_restricted(( SELECT auth.uid() AS uid)))))));","drop function if exists public.training_partners_cross_org_enabled();","drop function if exists public.can_see_profile(uuid);"].join("\n"),
    undoWhy: "Only if step 91 misbehaves (for example a name shows as 'Unknown' where it should show). Puts back the earlier open profiles rule and the platform-admin read of client content, exactly as they were.",
    rows: [
      ["0345 is not already applied (the open profiles rule is still there)", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_authenticated')"],
      ["the helpers the new rules use exist", has.fn("is_group_coach(uuid)") + " and " + has.fn("is_org_admin_of_group(uuid)") + " and " + has.fn("is_client_private_from_org(uuid, uuid)") + " and " + has.fn("is_org_owner_or_admin(uuid)") + " and " + has.fn("is_workout_visible_to_athlete(uuid)")],
      ["the tables the new rules read exist", "to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.client_tag_assignments') is not null and to_regclass('public.wearable_connections') is not null"],
    ],
  },
  {
    n: "92",
    slug: "0346",
    title: "0346 A coach using the app as their own client can do everything a client can: nutrition phase plans, macro-target feedback and transformation cards no longer require the athlete role; 'Assign to Myself' attaches the program",
    migrations: ["0346"],
    sees: "Success. No rows returned.",
    afterwards: "A coach in 'My training' can keep nutrition phases for themselves, send feedback on their own macro target, make transformation cards, and assign a program to themselves (it becomes theirs, not a copy, when it qualifies). Nothing changes for clients. Run AFTER Release AW.",
    undo: [
      "drop policy if exists \"client_phase_plans_coach_manage\" on public.client_phase_plans;",
      "create policy \"client_phase_plans_coach_manage\" on public.client_phase_plans for all to authenticated using (is_group_coach(group_id)) with check ((is_group_coach(group_id) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = client_phase_plans.group_id) AND (gm.profile_id = client_phase_plans.athlete_id) AND (gm.role = 'athlete'::member_role))))));",
      "drop policy if exists \"client_nutrition_feedback_insert_client\" on public.client_nutrition_feedback;",
      "create policy \"client_nutrition_feedback_insert_client\" on public.client_nutrition_feedback for insert to authenticated with check (((athlete_id = ( SELECT auth.uid() AS uid)) AND (status = 'new'::text) AND (handled_by IS NULL) AND (handled_at IS NULL) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = client_nutrition_feedback.group_id) AND (gm.profile_id = client_nutrition_feedback.athlete_id) AND (gm.role = 'athlete'::member_role)))) AND (EXISTS ( SELECT 1 FROM client_macro_target_history h WHERE ((h.athlete_id = client_nutrition_feedback.athlete_id) AND (h.group_id = client_nutrition_feedback.group_id) AND (h.effective_from = client_nutrition_feedback.target_effective_from))))));",
      "drop policy if exists \"transformation_cards_insert_own\" on public.transformation_cards;",
      "create policy \"transformation_cards_insert_own\" on public.transformation_cards for insert to authenticated with check (((athlete_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = transformation_cards.group_id) AND (gm.profile_id = ( SELECT auth.uid() AS uid)) AND (gm.role = 'athlete'::member_role)))) AND ((before_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.before_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((after_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.after_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((milestone_id IS NULL) OR (EXISTS ( SELECT 1 FROM transformation_milestones m WHERE ((m.id = transformation_cards.milestone_id) AND (m.athlete_id = ( SELECT auth.uid() AS uid)))))) AND (NOT (EXISTS ( SELECT 1 FROM client_intake ci WHERE ((ci.athlete_id = ( SELECT auth.uid() AS uid)) AND (ci.date_of_birth > ((CURRENT_DATE - '18 years'::interval))::date)))))));",
      "drop policy if exists \"transformation_cards_update_own\" on public.transformation_cards;",
      "create policy \"transformation_cards_update_own\" on public.transformation_cards for update to authenticated using ((athlete_id = ( SELECT auth.uid() AS uid))) with check (((athlete_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM group_memberships gm WHERE ((gm.group_id = transformation_cards.group_id) AND (gm.profile_id = ( SELECT auth.uid() AS uid)) AND (gm.role = 'athlete'::member_role)))) AND ((before_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.before_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((after_photo_id IS NULL) OR (EXISTS ( SELECT 1 FROM progress_photos p WHERE ((p.id = transformation_cards.after_photo_id) AND (p.athlete_id = ( SELECT auth.uid() AS uid)))))) AND ((milestone_id IS NULL) OR (EXISTS ( SELECT 1 FROM transformation_milestones m WHERE ((m.id = transformation_cards.milestone_id) AND (m.athlete_id = ( SELECT auth.uid() AS uid))))))));",
      fnFromMigration("0337", "assign_program_to_client"),
      "revoke execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) from public, anon;",
      "grant execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) to authenticated, service_role;",
    ].join("\n"),
    undoWhy: "Only if step 92 misbehaves. Puts back the three athlete-only rules and the assign function exactly as they were.",
    rows: [
      ["0346 is not already applied (the nutrition phase rule still requires the athlete role)", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_phase_plans' and policyname = 'client_phase_plans_coach_manage' and position('''athlete''::member_role' in with_check) > 0)"],
      ["the assign function and the three tables exist", "to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null and to_regclass('public.client_phase_plans') is not null and to_regclass('public.client_nutrition_feedback') is not null and to_regclass('public.transformation_cards') is not null"],
    ],
  },
  {
    n: "93",
    slug: "0347",
    title: "0347 The daily briefing is made once per coach, per day, per organization (a coach who runs two organizations no longer gets one briefing built from both)",
    migrations: ["0347"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes today. From the next morning's run, a coach who runs more than one organization gets a separate briefing for each, built only from that organization's clients, and Home shows the open organization's. Earlier briefings are kept as they were. Run this BEFORE the code that goes with it is live.",
    undo: [
      "create unique index if not exists coach_briefings_coach_id_briefing_date_key_undo on public.coach_briefings (coach_id, briefing_date);",
      "drop index if exists public.coach_briefings_coach_id_briefing_date_key_undo;",
      "drop index if exists public.coach_briefings_coach_day_org_key;",
      "alter table public.coach_briefings add constraint coach_briefings_coach_id_briefing_date_key unique (coach_id, briefing_date);",
      "alter table public.coach_briefings drop column if exists organization_id;",
    ].join("\n"),
    undoWhy: "Only if step 93 misbehaves, and only BEFORE the new code has made two briefings for one coach on one day (the undo then stops with an error and changes nothing). Puts back the one-per-coach-per-day rule and removes the organization column.",
    rows: [
      ["0347 is not already applied (the briefing has no organization column yet)", has.noCol("coach_briefings", "organization_id")],
      ["the briefing table exists", has.table("coach_briefings")],
    ],
  },
  {
    n: "94",
    slug: "0348",
    title: "0348 Defense in depth for the organization walls, installed switched OFF: the database learns to refuse a row of a different organization than the workspace a request names (nothing changes until step 95)",
    migrations: ["0348"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible changes: the rule is installed but switched off, so every request behaves exactly as before. It adds one extra rule (named org_wall_header) to each table whose rows belong to a group, and three helper functions. Run it BEFORE the code that goes with it is live; step 95 switches it on.",
    undo: [
      ...(/tables text\[\] := array\[([\s\S]*?)\];/.exec(migrationSql("0348"))[1].match(/'([a-z_]+)'/g).map((q) => q.replace(/'/g, ""))).map((t) => `drop policy if exists "org_wall_header" on public.${t};`),
      // Tables made after this step carry the same rule (the review notes, quotes, smaller goals, the AI notes ...): take it off every table that has it, so the function can be dropped.
      "do $u$ declare r record; begin for r in select schemaname, tablename from pg_policies where policyname = 'org_wall_header' and schemaname = 'public' loop execute format('drop policy %I on %I.%I', 'org_wall_header', r.schemaname, r.tablename); end loop; end $u$;",
      "drop function if exists public.group_in_active_org(uuid);",
      "drop function if exists public.request_workspace_org();",
      "drop function if exists public.org_wall_header_enabled();",
    ].join("\n"),
    undoWhy: "Only if step 94 misbehaves. Removes the extra rule from every table and the three helper functions. Undo step 95 first if it has been run.",
    rows: [
      ["0348 is not already applied (the workspace helper does not exist yet)", "to_regprocedure('public.request_workspace_org()') is null"],
      ["the group and organization tables the rule reads exist", "to_regclass('public.groups') is not null and to_regclass('public.programs') is not null and to_regclass('public.bookings') is not null"],
    ],
  },
  {
    n: "95",
    slug: "0349",
    title: "0349 Switch the organization-wall request header rule ON",
    migrations: ["0349"],
    sees: "Success. No rows returned.",
    afterwards: "From now on a request that names a workspace sees and changes only that workspace's organization. Run it AFTER the code that sends the header is live and verified; to switch it off again, undo this step (one line).",
    undo: "create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as 'select false';",
    undoWhy: "The off switch: puts the rule back to switched off without removing it. Safe at any time.",
    rows: [
      ["step 94 is applied (the switch function exists)", "to_regprocedure('public.org_wall_header_enabled()') is not null"],
      ["0349 is not already applied (the rule is still off)", "position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) = 0"],
    ],
  },
  {
    n: "96",
    slug: "0350",
    title: "0350 A coach's Pro Shop links, referral partners, challenges, calendar entries, session types and discovery-call prospects belong to an organization, and a client sees only the organization they are a client in",
    migrations: ["0350"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing is deleted. Each existing row is given the coach's usual organization (the only one, or the one with the most clients; a challenge takes its program's). From the code that goes with it, a coach who runs two organizations sees a separate shop, partner list, challenges, calendar entries and session types in each, and a client sees only their own organization's. Run it BEFORE the code that goes with it is live.",
    undo: "drop policy if exists \"pro_shop_links_select_own_or_client\" on public.pro_shop_links;\ncreate policy \"pro_shop_links_select_own_or_client\" on public.pro_shop_links for select to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)) OR is_client_of_coach(coach_id));\ndrop policy if exists \"pro_shop_links_insert_coach\" on public.pro_shop_links;\ncreate policy \"pro_shop_links_insert_coach\" on public.pro_shop_links for insert to authenticated with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"pro_shop_links_update_coach\" on public.pro_shop_links;\ncreate policy \"pro_shop_links_update_coach\" on public.pro_shop_links for update to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"pro_shop_links_delete_coach\" on public.pro_shop_links;\ncreate policy \"pro_shop_links_delete_coach\" on public.pro_shop_links for delete to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"referral_partners_select_own_or_client\" on public.referral_partners;\ncreate policy \"referral_partners_select_own_or_client\" on public.referral_partners for select to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)) OR is_client_of_coach(coach_id));\ndrop policy if exists \"referral_partners_insert_coach\" on public.referral_partners;\ncreate policy \"referral_partners_insert_coach\" on public.referral_partners for insert to authenticated with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"referral_partners_update_coach\" on public.referral_partners;\ncreate policy \"referral_partners_update_coach\" on public.referral_partners for update to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"referral_partners_delete_coach\" on public.referral_partners;\ncreate policy \"referral_partners_delete_coach\" on public.referral_partners for delete to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"challenges_select_own_or_client\" on public.challenges;\ncreate policy \"challenges_select_own_or_client\" on public.challenges for select to authenticated using (((coach_id = ( SELECT auth.uid() AS uid)) OR ((status <> 'draft'::challenge_status) AND is_client_of_coach(coach_id))));\ndrop policy if exists \"challenges_insert_coach\" on public.challenges;\ncreate policy \"challenges_insert_coach\" on public.challenges for insert to authenticated with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"challenges_update_coach\" on public.challenges;\ncreate policy \"challenges_update_coach\" on public.challenges for update to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"challenges_delete_coach\" on public.challenges;\ncreate policy \"challenges_delete_coach\" on public.challenges for delete to authenticated using ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"calendar_events_owner\" on public.calendar_events;\ncreate policy \"calendar_events_owner\" on public.calendar_events for all to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"session_types_coach_manage\" on public.session_types;\ncreate policy \"session_types_coach_manage\" on public.session_types for all to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop policy if exists \"discovery_bookings_coach_manage\" on public.discovery_bookings;\ncreate policy \"discovery_bookings_coach_manage\" on public.discovery_bookings for all to authenticated using ((coach_id = ( SELECT auth.uid() AS uid))) with check ((coach_id = ( SELECT auth.uid() AS uid)));\ndrop trigger if exists pro_shop_links_fill_organization on public.pro_shop_links;\ndrop trigger if exists referral_partners_fill_organization on public.referral_partners;\ndrop trigger if exists challenges_fill_organization on public.challenges;\ndrop trigger if exists calendar_events_fill_organization on public.calendar_events;\ndrop trigger if exists session_types_fill_organization on public.session_types;\ndrop trigger if exists discovery_bookings_fill_organization on public.discovery_bookings;\ndrop function if exists public.fill_calendar_event_organization();\ndrop function if exists public.fill_coach_row_organization();\ndrop function if exists public.client_of_coach_in_org(uuid, uuid);\ndrop function if exists public.coach_in_org(uuid);\ndrop function if exists public.default_org_for_coach(uuid);\nalter table public.pro_shop_links drop column if exists organization_id;\nalter table public.referral_partners drop column if exists organization_id;\nalter table public.challenges drop column if exists organization_id;\nalter table public.calendar_events drop column if exists organization_id;\nalter table public.session_types drop column if exists organization_id;\nalter table public.discovery_bookings drop column if exists organization_id;",
    undoWhy: "Only if step 96 misbehaves. Puts back the earlier rules exactly and removes the organization column from the six tables (the sorting into organizations is lost; no row is deleted).",
    rows: [
      ["0350 is not already applied (the shop links have no organization column yet)", has.noCol("pro_shop_links", "organization_id")],
      ["the six tables exist", "to_regclass('public.pro_shop_links') is not null and to_regclass('public.referral_partners') is not null and to_regclass('public.challenges') is not null and to_regclass('public.calendar_events') is not null and to_regclass('public.session_types') is not null and to_regclass('public.discovery_bookings') is not null"],
      ["the helper is_client_of_coach exists", has.fnName("is_client_of_coach")],
    ],
  },
  {
    n: "97",
    slug: "0351",
    title: "0351 Duplicate makes an unassigned library program: a copy that is not for a client comes out not active, so no team or client sees it until the coach assigns it or sets it active",
    migrations: ["0351"],
    sees: "Success. No rows returned.",
    afterwards: "Duplicate (same group, another group, another organization) now puts a copy in the coach's library instead of making it live. A copy made for one client (Assign) is unchanged. Nothing existing is changed.",
    undo: fnFromMigration("0324", "duplicate_program"),
    undoWhy: "Only if step 97 misbehaves. Puts back the earlier Duplicate, which came out active.",
    rows: [
      ["0351 is not already applied (Duplicate still comes out active)", "position('p_athlete_id is null then false' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) = 0"],
      ["Duplicate exists", "to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null"],
    ],
  },
  {
    n: "98",
    slug: "0352",
    title: "0352 Joining an organization needs the person's OK: an owner can no longer put an existing account into their organization; an invitation is accepted or declined by the person, and any member can leave",
    migrations: ["0352"],
    sees: "Success. No rows returned.",
    afterwards: "An organization's owner can no longer add an existing person to the organization on their own. A new coach invited by email still joins by setting their password; a person who already has an account gets an invitation they accept or decline. Anyone but the owner can leave. Nothing existing changes.",
    undo: "drop function if exists public.profile_id_for_email(text);\ndrop function if exists public.leave_organization(uuid);\ndrop function if exists public.answer_organization_invite(uuid, boolean);\ndrop table if exists public.organization_invites;\ncreate policy \"org_memberships_insert_owner\" on public.organization_memberships for insert to authenticated with check ((EXISTS ( SELECT 1 FROM organizations o WHERE ((o.id = organization_memberships.organization_id) AND (o.owner_id = ( SELECT auth.uid() AS uid))))));",
    undoWhy: "Only if step 98 misbehaves. Puts back the owner's right to insert memberships and removes the invitations and the leave function (pending invitations are lost).",
    rows: [
      ["0352 is not already applied (the invitations table does not exist yet)", "to_regclass('public.organization_invites') is null"],
      ["the memberships table has the owner's insert rule", has.policy("organization_memberships", "org_memberships_insert_owner")],
    ],
  },
  {
    n: "99",
    slug: "0353",
    title: "0353 A coach can ask for notice before a client pauses, freezes or ends a weekly schedule, and can add their own wording",
    migrations: ["0353"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for a coach who sets nothing (the default is no notice). A coach who sets days of notice on the Availability page: a client's pause, freeze or end request for a sooner date is refused with the earliest date in plain words, and the client sees the coach's words.",
    undo: [
      fnFromMigration("0297", "request_schedule_change"),
      "alter table public.coach_booking_policies drop column if exists schedule_change_notice_text;",
      "alter table public.coach_booking_policies drop column if exists schedule_change_notice_days;",
    ].join("\n"),
    undoWhy: "Only if step 99 misbehaves. Puts back the earlier request function and removes the two columns (a notice a coach had set is lost).",
    rows: [
      ["0353 is not already applied (no notice column yet)", has.noCol("coach_booking_policies", "schedule_change_notice_days")],
      ["the schedule-request function exists", has.fn("request_schedule_change(uuid, text, date, date, text)")],
    ],
  },
  {
    n: "100",
    slug: "0354",
    title: "0354 The money settings on an organization membership are the server's: the connected Stripe account can no longer be written by an owner or anyone signed in, and the shares in an organization can never add up to more than 100 percent",
    migrations: ["0354"],
    sees: "Success. No rows returned.",
    afterwards: "A coach still connects their own Stripe account through the Connect screen, and an organization owner still sets each member's role and revenue share; nobody signed in can change a member's connected account any more. A share that would take the total over 100% is refused with 'These shares add up to more than 100%. Lower one to save.' A new organization's owner starts with the whole share (100%). Nothing existing changes.",
    undo: "drop trigger if exists organization_memberships_share_total on public.organization_memberships;\ndrop function if exists public.guard_organization_share_total();\ngrant insert, update on public.organization_memberships to authenticated, anon;",
    undoWhy: "Only if step 100 misbehaves. Puts back the broad write rights on memberships (so an owner could again write the connected account) and removes the 100% rule.",
    rows: [
      ["0354 is not already applied (the share-total rule does not exist yet)", "to_regprocedure('public.guard_organization_share_total()') is null"],
      ["the memberships table has the money columns", has.col("organization_memberships", "stripe_connect_account_id") + " and " + has.col("organization_memberships", "revenue_share_pct")],
    ],
  },
  {
    n: "101",
    slug: "0355",
    title: "0355 A coach can attach their own assessments (notes, numbers and a PDF, photo or video) to a client's profile; only the coaches of that client's group can see them",
    migrations: ["0355"],
    sees: "Success. No rows returned.",
    afterwards: "A new Assessments section on a client's profile (Forms and notes) where a coach adds a title, notes, optional numbers and one file. Only the coaches of that group see them, not the client, the organization's owner or admins, or the platform. Nothing existing changes.",
    undo: "drop policy if exists \"client_assessments_files_delete\" on storage.objects;\ndrop policy if exists \"client_assessments_files_insert\" on storage.objects;\ndrop policy if exists \"client_assessments_files_select\" on storage.objects;\ndrop table if exists public.client_assessments;",
    undoWhy: "Only if step 101 misbehaves. Removes the assessments table (and so every assessment saved) and the storage rules; uploaded files stay in storage until removed there.",
    rows: [
      ["0355 is not already applied (the assessments table does not exist yet)", "to_regclass('public.client_assessments') is null"],
      ["the storage and group tables the rules read exist", "to_regclass('storage.objects') is not null and to_regclass('public.group_memberships') is not null"],
    ],
  },
  {
    n: "102",
    slug: "0356",
    title: "0356 Asking a happy client for a review, once and quietly: a one-time card after 12 sessions with a box for a short review and a tick to agree the coach may share it publicly, and quotes the coach approves",
    migrations: ["0356"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing visible until an adult client reaches 12 sessions. They see one small card, once. A review they send is private to the coach unless they ticked that the coach may share it; only a ticked one can go on the coach's page, and only when the coach adds it.",
    undo: "drop table if exists public.review_prompts_shown;\ndrop table if exists public.client_quotes;\ndrop function if exists public.client_quotes_refuse_minor();",
    undoWhy: "Only if step 102 misbehaves. Removes the quotes and the record of who was shown the card (their contents are lost).",
    rows: [
      ["0356 is not already applied (no quotes table yet)", "to_regclass('public.client_quotes') is null"],
      ["the coach website table exists", "to_regclass('public.coach_sites') is not null"],
    ],
  },
  {
    n: "104",
    slug: "0358",
    title: "0358 A personal space: every person can have one space of their own that belongs to no organization, so a coach's own training is one set that follows them into every organization",
    migrations: ["0358"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen by itself. A coach's own training space is created the first time they open their own client view, named after their profile, and it appears in every organization they coach in as their own row in the Clients list. No organization's owner, admin or rival can read it, and it is in no organization's counts or billing.",
    undo: "drop trigger if exists group_memberships_guard_personal_space on public.group_memberships;\ndrop function if exists public.guard_personal_space_members();\ndrop trigger if exists notifications_skip_personal_space on public.notifications;\ndrop function if exists public.skip_personal_space_notifications();\ndrop function if exists public.ensure_personal_space();\ndrop index if exists public.groups_one_personal_space_per_person;\n" + fnFromMigration("0348", "group_in_active_org") + "\n" + fnFromMigration("0333", "guard_one_on_one_program") + "\nrevoke all on function public.guard_one_on_one_program() from public, anon, authenticated;\ndo $u$ begin if not exists (select 1 from public.groups where organization_id is null) then alter table public.groups alter column organization_id set not null; end if; end $u$;",
    undoWhy: "Only if step 104 misbehaves. Puts the organization wall back as it was and removes the personal-space function. Personal spaces already created stay (and the column stays optional while any exist), so nothing anyone saved is lost.",
    rows: [
      ["0358 is not already applied (the personal-space function does not exist yet)", "to_regprocedure('public.ensure_personal_space()') is null"],
      ["the organization wall function and the groups table exist", "to_regprocedure('public.group_in_active_org(uuid)') is not null and to_regclass('public.groups') is not null"],
    ],
  },
  {
    n: "105",
    slug: "move-ron-personal-training",
    title: "move Coach Ron's own training (his programs not yet removed, their workouts, his sessions, workout log and wellness check-ins in The Enduring Strength Collective) into his personal space; undoable",
    migrations: [],
    warn: "A one-time data change for Coach Ron's OWN rows only. Run it after Coach Ron has opened Coach Ron (you) in the Clients list once (that creates his personal space) and after he has removed the programs he does not want. It stops with nothing changed if the space does not exist yet.",
    sees: "Success. No rows returned.",
    afterwards: "Coach Ron's remaining programs (and their workouts, exercises, logs, sessions and wellness check-ins) now live in his personal space and show in his own client view and on his own client profile in every organization. Nothing is deleted. To see what moved:  select tbl, count(*) from public.personal_space_move_log group by tbl order by tbl;",
    bodySql: readFileSync(new URL("./release-bk-move.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undo: readFileSync(new URL("./release-bk-undo.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undoWhy: "Only if the move is wrong. Puts every moved row back in The Enduring Strength Collective and drops the log table.",
    rows: [
      ["Coach Ron's profile exists", "exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')"],
      ["Coach Ron's personal space exists (he has opened Coach Ron (you) once)", "exists (select 1 from public.groups where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and organization_id is null)"],
      ["there is exactly one group named The Enduring Strength Collective", "(select count(*) from public.groups where name = 'The Enduring Strength Collective' and organization_id is not null) = 1"],
      ["there is at least one program of Coach Ron's there that has not been removed", "exists (select 1 from public.programs p join public.groups g on g.id = p.group_id where g.name = 'The Enduring Strength Collective' and p.athlete_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and p.archived_at is null)"],
      ["step 105 is not already applied (the move log is not there yet)", "to_regclass('public.personal_space_move_log') is null"],
    ],
  },
  {
    n: "106",
    slug: "add-fitpros-exercises",
    title: "add four exercises to Coach Ron's library (Sissy Squat, Thoracic Extension (Quadruped), Handcuff W Rotation, Incline Iso Lateral Chest Press) so the FitPros history links to real rows; undoable",
    migrations: [],
    warn: "A one-time data change for Coach Ron's library ONLY. They are marked to be promoted to the shared catalog when it exists.",
    sees: "Success. No rows returned.",
    afterwards: "Four new entries in Coach Ron's exercise library, and typing the FitPros spellings (Sissy Squats, Thoracic Extensions (Quadruped)) finds them. Nothing else changes.",
    bodySql: "insert into public.exercise_library (created_by, name, category, description)\nselect '136394ed-f108-4283-bcb7-310a1ac6cbc8', v.name, v.category, 'Added from the FitPros import. To be promoted to the shared catalog when it exists.'\nfrom (values ('Sissy Squat', 'Legs'), ('Thoracic Extension (Quadruped)', 'Cardio/Mobility'), ('Handcuff W Rotation', 'Cardio/Mobility'), ('Incline Iso Lateral Chest Press', 'Push')) as v(name, category)\nwhere not exists (select 1 from public.exercise_library l where l.created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(l.name) = lower(v.name));\n\ninsert into public.exercise_aliases (coach_id, raw_name, exercise_name)\nselect '136394ed-f108-4283-bcb7-310a1ac6cbc8', v.raw_name, v.exercise_name\nfrom (values ('Sissy Squats', 'Sissy Squat'), ('Thoracic Extensions (Quadruped)', 'Thoracic Extension (Quadruped)')) as v(raw_name, exercise_name)\nwhere not exists (select 1 from public.exercise_aliases a where a.coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(a.raw_name) = lower(v.raw_name));",
    undo: "delete from public.exercise_aliases where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and raw_name in ('Sissy Squats', 'Thoracic Extensions (Quadruped)') and exercise_name in ('Sissy Squat', 'Thoracic Extension (Quadruped)');\ndelete from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name in ('Sissy Squat', 'Thoracic Extension (Quadruped)', 'Handcuff W Rotation', 'Incline Iso Lateral Chest Press') and description like 'Added from the FitPros import.%';",
    undoWhy: "Only if step 106 is wrong. Removes the four entries and the two spelling aliases it added (only those, recognised by their note).",
    rows: [
      ["Coach Ron's profile exists", "exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')"],
      ["none of the four exercises is in Coach Ron's library yet", "not exists (select 1 from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(name) in ('sissy squat', 'thoracic extension (quadruped)', 'handcuff w rotation', 'incline iso lateral chest press'))"],
    ],
  },
  {
    n: "107",
    slug: "0359",
    title: "0359 Weights from a history import (the FitPros import) no longer set training maxes, so an old number from another app cannot steer what a client, above all a minor, is prescribed",
    migrations: ["0359"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen. Live workouts and the coach's own quick-entry and spreadsheet history still set training maxes exactly as before; sets under a FitPros import (stamped noon, 00 minutes, 17 to 19 seconds) are left out.",
    undo: fnFromMigration("0171", "recompute_training_max"),
    undoWhy: "Only if step 107 misbehaves. Puts the training-max trigger function back as it was (imported sets would raise maxes again).",
    rows: [
      ["the training-max trigger function exists", "to_regprocedure('public.recompute_training_max()') is not null"],
      ["0359 is not already applied (the function does not leave out import stamps yet)", "position('12:00:17' in pg_get_functiondef(to_regprocedure('public.recompute_training_max()'))) = 0"],
    ],
  },
  {
    n: "109",
    slug: "remove-empty-rob-derrick-groups",
    title: "remove the two empty one-on-one groups named Rob Derrick left behind by the failed add-client attempts (both have no members, programs, sessions, posts or invites); undoable",
    migrations: [],
    warn: "A one-time data change that deletes exactly two EMPTY groups by id (e2425435-950a-409d-8d4e-e24d92f21652 and 568e84b6-b85c-476c-b160-7b6b64e21caa). It stops with nothing changed if either one has any member, program, session, post or invite.",
    sees: "Success. No rows returned.",
    afterwards: "The two stray Rob Derrick groups are gone. Nothing else changes. To see what was removed:  select row->>'id', row->>'name', row->>'created_at' from public.orphan_group_cleanup_log;",
    bodySql: "create table public.orphan_group_cleanup_log (\n  id bigserial primary key,\n  row jsonb not null,\n  cleaned_at timestamptz not null default now()\n);\nalter table public.orphan_group_cleanup_log enable row level security;\nrevoke all on public.orphan_group_cleanup_log from anon, authenticated;\n\ndo $clean$\ndeclare\n  v_ids constant uuid[] := array['e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa']::uuid[];\nbegin\n  if (select count(*) from public.groups where id = any (v_ids) and name = 'Rob Derrick' and group_kind = 'one_on_one') <> 2 then\n    raise exception 'Expected exactly the two empty Rob Derrick groups.';\n  end if;\n  if exists (select 1 from public.group_memberships where group_id = any (v_ids))\n     or exists (select 1 from public.programs where group_id = any (v_ids))\n     or exists (select 1 from public.athlete_sessions where group_id = any (v_ids))\n     or exists (select 1 from public.posts where group_id = any (v_ids))\n     or exists (select 1 from public.group_invites where group_id = any (v_ids)) then\n    raise exception 'One of the Rob Derrick groups is not empty; nothing was removed.';\n  end if;\n  insert into public.orphan_group_cleanup_log (row) select to_jsonb(g) from public.groups g where g.id = any (v_ids);\n  delete from public.groups where id = any (v_ids);\nend;\n$clean$;",
    undo: "insert into public.groups select * from jsonb_populate_recordset(null::public.groups, (select coalesce(jsonb_agg(row), '[]'::jsonb) from public.orphan_group_cleanup_log));\ndrop table public.orphan_group_cleanup_log;",
    undoWhy: "Only if the cleanup was wrong. Puts the two empty groups back exactly as they were (from the log) and drops the log.",
    rows: [
      ["both stray groups exist", "(select count(*) from public.groups where id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa') and name = 'Rob Derrick' and group_kind = 'one_on_one') = 2"],
      ["neither has a member, program, session, post or invite", "not exists (select 1 from public.group_memberships where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.programs where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.athlete_sessions where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.posts where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.group_invites where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa'))"],
      ["step 109 is not already applied (the cleanup log is not there yet)", "to_regclass('public.orphan_group_cleanup_log') is null"],
    ],
  },
  {
    n: "108",
    slug: "0360",
    title: "0360 Adding a client works again: the person who has just created a group can seat themselves in it as its coach (a new one-on-one space was refusing its very first membership)",
    migrations: ["0360"],
    sees: "Success. No rows returned.",
    afterwards: "Adding a client (and making a team or social group, or moving a client to a new space) now finishes: the coach is seated in the new group. The rule only works for the creator of a group that has no members yet.",
    undo: "drop policy if exists \"memberships_insert_coach_or_self\" on public.group_memberships;\ncreate policy \"memberships_insert_coach_or_self\" on public.group_memberships for insert\n  to authenticated with check (\n    (public.is_group_coach(group_id) and (profile_id = (select auth.uid()) or public.is_coach_of_athlete(profile_id)))\n    or (\n      profile_id = (select auth.uid())\n      and role = 'coach'\n      and public.is_org_admin_of_group(group_id)\n      and not public.group_closed_to_org_admin_join(group_id)\n    )\n  );\ndrop function if exists public.group_is_new_and_mine(uuid);",
    undoWhy: "Only if step 108 misbehaves. Puts the membership rule back as it was (adding a client would fail again) and removes the helper.",
    rows: [
      ["0360 is not already applied (the creator helper does not exist yet)", "to_regprocedure('public.group_is_new_and_mine(uuid)') is null"],
      ["the membership rule and its helpers exist", "to_regprocedure('public.group_closed_to_org_admin_join(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null"],
    ],
  },
  {
    n: "110",
    slug: "0361",
    title: "0361 The shared exercise catalog (empty): one list of real movements everyone can read and only the platform admin can write, and a link from each coach's library entry to its movement",
    migrations: ["0361"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen. Two new empty tables (the catalog and its spellings) and one new empty column on the exercise library.",
    undo: "alter table public.exercise_library drop column if exists catalog_id;\ndrop table if exists public.exercise_catalog_aliases;\ndrop table if exists public.exercise_catalog;",
    undoWhy: "Only if step 110 misbehaves. Removes the catalog tables and the link column (they are empty or only hold names).",
    rows: [
      ["0361 is not already applied (the catalog table does not exist yet)", "to_regclass('public.exercise_catalog') is null"],
      ["the platform-admin helper and the exercise library exist", "to_regprocedure('public.is_platform_admin()') is not null and to_regclass('public.exercise_library') is not null"],
    ],
  },
  {
    n: "111",
    slug: "catalog-merge-ron",
    title: "Coach Ron's exercise names: 9 merges and 9 renames (the implement stated), his four FitPros exercises, and the shared catalog filled from his library; undoable",
    migrations: [],
    warn: "A one-time data change for Coach Ron's library and world ONLY, decided by Ron on Oct 12. Run step 110 first. It rewrites the exercise name in his programs, his clients' sessions, records, patterns, tags and maxes, saves each old name as an alias of the final one, deletes the merged-away library rows, and fills the catalog. Every changed or deleted row is saved first (exercise_catalog_merge_log, exercise_catalog_merge_deleted) and the undo file puts it all back. It refuses by itself if any old name is missing from his library.",
    sees: "Success. No rows returned.",
    afterwards: "Each old name is now the final name everywhere in Ron's programs and history, typing an old name still finds the final one, the library lists each exercise once, and the catalog holds one entry per exercise with its spellings. To see how many rows changed per table: select tbl, col, count(*) from public.exercise_catalog_merge_log group by tbl, col order by tbl, col;",
    bodySql: readFileSync(new URL("./release-catalog-merge.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undo: readFileSync(new URL("./release-catalog-undo.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undoWhy: "Only if the merge is wrong. Puts every changed name back, brings the merged-away library rows back, gives renamed entries their old names and videos, removes the aliases and catalog entries this step added, and drops the two log tables.",
    rows: [
      ["Coach Ron's profile exists", "exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')"],
      ["step 110 is applied (the catalog is there and empty)", "case when to_regclass('public.exercise_catalog') is null then false else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.exercise_catalog', false, true, '')))[1]::text = '0' end"],
      ...CATALOG_PREVIEW.map(([text, names]) => ["PREVIEW " + text + " (all these names are in Coach Ron's library)", "(select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array[" + names.map((n) => "'" + n.replace(/'/g, "''") + "'").join(", ") + "])) = " + names.length]),
      ["the four FitPros exercises are in Coach Ron's library", "(select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name in ('Sissy Squat', 'Thoracic Extension (Quadruped)', 'Handcuff W Rotation', 'Incline Iso Lateral Chest Press')) = 4"],
      ["step 111 is not already applied (the merge log is not there yet)", "to_regclass('public.exercise_catalog_merge_log') is null"],
    ],
  },
  {
    n: "112",
    slug: "0362",
    title: "0362 Each storage bucket accepts only the file types its screen uploads (the three public buckets included), post-media gets a 100 MB size limit, and the signed-out role has no rights on the coach website table",
    migrations: ["0362"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes for normal use: photos, videos and PDFs upload as before. A file of any other type (an executable, a script, an HTML page) is now refused by the storage service. Existing files are not touched.",
    undo: "update storage.buckets set allowed_mime_types = null where id in ('coach-profile-photos', 'pro-shop-images', 'org-branding', 'program-covers', 'progress-photos', 'athlete-exercise-videos', 'exercise-media', 'coach-video-checkins', 'post-media', 'client-assessments', 'waiver-documents');\nupdate storage.buckets set file_size_limit = null where id = 'post-media';\ngrant all on public.coach_sites to anon;",
    undoWhy: "Only if step 112 refuses a file type a screen really needs. Takes the type lists and the post-media size limit off again and gives the signed-out role its default table rights back.",
    rows: [
      ["0362 is not already applied (the profile photo bucket has no type list yet)", "coalesce((select allowed_mime_types is null from storage.buckets where id = 'coach-profile-photos'), true)"],
      ["the storage buckets and the coach website table exist", "to_regclass('storage.buckets') is not null and to_regclass('public.coach_sites') is not null"],
    ],
  },
  {
    n: "113",
    slug: "0363",
    title: "0363 Smaller goals under a client's goal: either side adds one, the other side agrees or says not now, an agreed one can be marked done (nothing changes a program or a nutrition target)",
    migrations: ["0363"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then the client's My Goal page and the coach's view of the client show a Smaller goals section. Changing a state goes through the server only.",
    undo: "drop table if exists public.client_sub_goals;",
    undoWhy: "Only if step 113 misbehaves. Removes the smaller-goals table and every smaller goal saved so far.",
    rows: [
      ["0363 is not already applied (the smaller-goals table does not exist yet)", "to_regclass('public.client_sub_goals') is null"],
      ["the goals table and the group helpers exist", "to_regclass('public.client_goals') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null"],
    ],
  },
  {
    n: "114",
    slug: "0364",
    title: "0364 A group session (class) belongs to one organization: members see, join and are counted in only the classes of an organization in which they are that coach's client (no class exists yet)",
    migrations: ["0364"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen: there are no group sessions yet. From now on a class is made inside one organization, and a client sees it only through that organization. Run it BEFORE the code that goes with it is live.",
    undo: readFileSync(new URL("./release-bt-undo.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undoWhy: "Only if step 114 misbehaves. Puts the four class functions and the client rule back as they were and removes the organization column (safe while no class exists; a class made after this step would lose its organization).",
    rows: [
      ["0364 is not already applied (the class table has no organization column yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_sessions' and column_name = 'organization_id')"],
      ["the class table is empty (so no class is left without an organization)", "case when to_regclass('public.group_sessions') is null then false else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.group_sessions where kind = ''class''', false, true, '')))[1]::text = '0' end"],
    ],
  },
  {
    n: "115",
    slug: "0365",
    title: "0365 Pattern and class templates: a ladder exercise can be marked one-sided (unilateral); the slot columns on a workout exercise and a client's training level are added (all empty, nothing reads them yet)",
    migrations: ["0365"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then the Exercise Library can be sorted by pattern, side and class, and Add the starter ladders appears on the Movement Patterns tab. Run it BEFORE the code that goes with it is live.",
    undo: "alter table public.group_memberships drop column if exists training_level;\nalter table public.group_workout_exercises drop column if exists slot_tier, drop column if exists slot_side, drop column if exists is_slot;\nalter table public.movement_pattern_exercises drop column if exists is_unilateral;",
    undoWhy: "Only if step 115 misbehaves. Removes the four new empty columns (safe until a unilateral mark or a slot has been saved; those marks would be lost).",
    rows: [
      ["0365 is not already applied (the ladder table has no unilateral column yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'movement_pattern_exercises' and column_name = 'is_unilateral')"],
      ["the ladder, workout exercise and membership tables exist", "to_regclass('public.movement_pattern_exercises') is not null and to_regclass('public.group_workout_exercises') is not null and to_regclass('public.group_memberships') is not null"],
    ],
  },
  {
    n: "116",
    slug: "0366",
    title: "0366 Template slots survive Duplicate, and a program that still has a slot cannot be given to a client (the duplicate-program function is replaced; the two flags added by step 115 may be empty so the old restore scripts still work)",
    migrations: ["0366"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then a template with slots can be duplicated and kept in the library, and assigning one to a client says it cannot be assigned yet. Run it AFTER step 115 (Release BU) and BEFORE the code that goes with it is live.",
    undo: readFileSync(new URL("./release-bv-undo.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
    undoWhy: "Only if step 116 misbehaves. Puts the duplicate-program function back as it was (a copy then drops the slot marks, so do not use it once a template with slots exists).",
    rows: [
      ["0366 is not already applied (the duplicate-program function does not know about slots yet)", "position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) = 0"],
      ["Release BU is applied (the slot columns exist)", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'is_slot')"],
    ],
  },
  {
    n: "117",
    slug: "0367",
    title: "0367 A rest can be a range: a new empty column holds the high end (the low end stays where it is), and Duplicate copies it",
    migrations: ["0367"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then a coach can give a rest as a range (60-90): it shows as 60-90 s, and the client's timer counts to the low end, tells them they can go, and keeps counting to the high end. A single time stays a single time. Run it AFTER step 116 (Release BV) and BEFORE the code.",
    undo: "alter table public.group_workout_exercise_sets drop constraint if exists group_workout_exercise_sets_rest_range;" + "\n" + "alter table public.group_workout_exercise_sets drop column if exists target_rest_max_seconds;" + "\n" + fnFromMigration("0366", "duplicate_program"),
    undoWhy: "Only if step 117 misbehaves. Removes the high end of every rest range (those become their low end only) and puts the duplicate-program function back as step 116 left it.",
    rows: [
      ["0367 is not already applied (no rest high-end column yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercise_sets' and column_name = 'target_rest_max_seconds')"],
      ["Release BV is applied (Duplicate knows about slots)", "position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) > 0"],
    ],
  },
  {
    n: "118",
    slug: "0368",
    title: "0368 The one product shelf: where each package and Pro Shop card shows (public page, Client Home, Pro Shop) and who in the app sees it (everyone, not the one-on-one clients, only the one-on-one clients, one group); a program buyer can join the coach's client space",
    migrations: ["0368"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Every existing package and Pro Shop card keeps showing exactly where it did, to everyone. Cards that are featured today are also marked for the public page, so no coach's public page changes. Run it BEFORE the code.",
    undo: "alter table public.coach_packages drop constraint if exists coach_packages_audience_check;" + "\n" + "alter table public.pro_shop_links drop constraint if exists pro_shop_links_audience_check;" + "\n" + "alter table public.coach_packages drop column if exists show_on_home, drop column if exists show_in_pro_shop, drop column if exists audience, drop column if exists audience_group_id, drop column if exists buyer_joins_space;" + "\n" + "alter table public.pro_shop_links drop column if exists show_on_public, drop column if exists audience, drop column if exists audience_group_id;",
    undoWhy: "Only if step 118 misbehaves. Removes the placement and audience settings (every card goes back to showing as it did before: the public page then shows nothing from the Pro Shop until the code is rolled back too).",
    rows: [
      ["0368 is not already applied (no placement columns yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'audience')"],
      ["the Pro Shop table has the Featured flag", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pro_shop_links' and column_name = 'featured')"],
    ],
  },
  {
    n: "119",
    slug: "0369",
    title: "0369 The AI you can train: rules the coach teaches that apply only to the clients they fit, a short list of Past AI build notes for each client, corrections recorded with their reason, and the one-time note about how the AI learns",
    migrations: ["0369"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then a correction typed while the AI builder is paused offers, once, to remember it for the clients it fits, the AI keeps a few short notes about each client you build for (editable from the AI box), and what the AI has learned shows under What I've learned about how you coach. Existing learned swaps keep working. Run it BEFORE the code.",
    undo: "delete from public.coach_learned_rules where kind <> 'swap';\nalter table public.coach_learned_rules drop constraint if exists coach_learned_rules_scope_check;\nalter table public.coach_learned_rules drop column if exists when_keys, drop column if exists then_text, drop column if exists scope, drop column if exists client_id, drop column if exists source, drop column if exists confirmations;\nalter table public.coach_learned_rules drop constraint if exists coach_learned_rules_kind_check;\nalter table public.coach_learned_rules add constraint coach_learned_rules_kind_check check (kind in ('swap'));\nalter table public.coach_learned_rules alter column from_name set not null;\nalter table public.coach_learned_rules alter column to_name set not null;\ndelete from public.coach_edit_events where kind = 'correction';\nalter table public.coach_edit_events drop constraint if exists coach_edit_events_kind_check;\nalter table public.coach_edit_events add constraint coach_edit_events_kind_check check (kind in ('swap', 'sets_reps', 'order', 'removed', 'added'));\nalter table public.coach_edit_events drop column if exists context, drop column if exists why, drop column if exists reason_tags, drop column if exists source;\nalter table public.coach_learning_settings drop column if exists intro_seen_at;\ndrop table if exists public.client_ai_notes;",
    undoWhy: "Only if step 119 misbehaves. Removes the new rules, the Past AI build notes and the correction events (the old swap rules and their preference lines are kept exactly as they were).",
    rows: [
      ["0369 is not already applied (no AI notes table yet)", "to_regclass('public.client_ai_notes') is null"],
      ["the Stage 2 learning tables exist", "to_regclass('public.coach_learned_rules') is not null and to_regclass('public.coach_edit_events') is not null"],
    ],
  },
  {
    n: "120",
    slug: "0370",
    title: "0370 The Needs attention list can be quieted: Not now (a week) and No macros for a client",
    migrations: ["0370"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then every item on Needs attention has Not now (hidden for a week, back only if still true), the macros item also has No macros for [name], and the client's Nutrition tab shows Macros are off for [name] with Turn on. Run it BEFORE the code.",
    undo: "drop table if exists public.attention_snoozes;" + String.fromCharCode(10) + "alter table public.group_memberships drop column if exists coach_sets_macros;",
    undoWhy: "Only if step 120 misbehaves. Removes the one-week hides and the No macros setting (every nudge then shows as it did before).",
    rows: [
      ["0370 is not already applied (no snooze table yet)", "to_regclass('public.attention_snoozes') is null"],
      ["the memberships table exists", "to_regclass('public.group_memberships') is not null"],
    ],
  },
  {
    n: "121",
    slug: "0371",
    title: "0371 Unclear data points in imported history are marked, kept, and left out of the numbers",
    migrations: ["0371"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes in any total or graph. Imported sets that look jumbled or impossible (a weight ten times the rest, reps over 100, a weight with no reps, a last set far below the others) are marked once, for every client who has imported history. Each stays exactly as entered. The coach sees them on the client's History page and on the session, with Count it, and the import screen reports how many it found.",
    undo: "drop function if exists public.set_unclear_point_counted(uuid, boolean);" + String.fromCharCode(10) + "drop function if exists public.flag_unclear_sets(uuid, uuid);" + String.fromCharCode(10) + "drop trigger if exists set_logs_guard_flag_insert on public.set_logs;" + String.fromCharCode(10) + "drop trigger if exists set_logs_guard_flag_update on public.set_logs;" + String.fromCharCode(10) + "drop function if exists public.guard_set_log_flag_columns();" + String.fromCharCode(10) + "drop index if exists public.set_logs_unclear_idx;" + String.fromCharCode(10) + "alter table public.set_logs drop constraint if exists set_logs_data_flag_check;" + String.fromCharCode(10) + "alter table public.set_logs drop column if exists data_flag, drop column if exists data_flag_reason;",
    undoWhy: "Only if step 121 misbehaves. Removes the marks (every imported set is a plain set again, exactly as entered).",
    rows: [
      ["0371 is not already applied (no mark column yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag')"],
      ["the set logs table exists", "to_regclass('public.set_logs') is not null"],
      ["the org wall check exists", "to_regprocedure('public.group_in_active_org(uuid)') is not null"],
    ],
  },
  {
    n: "122",
    slug: "0372",
    title: "0372 Imported history counts: totals, graphs, estimated maxes and records are read from the sets, and training maxes are rebuilt",
    migrations: ["0372"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing else to do. The training maxes of every client who has imported history are rebuilt once from the sets that count (the old value of each one that changed is kept, so this step can be undone). Until the code that goes with it is live nothing on screen changes, except that a training max can now go DOWN when it came from an unclear or removed set. A set of more than 12 reps no longer sets a training max.",
    undo: [
      "delete from public.athlete_training_maxes m using public.training_max_recompute_log l where m.athlete_id = l.athlete_id and m.exercise_name = l.exercise_name;",
      "insert into public.athlete_training_maxes select (jsonb_populate_record(null::public.athlete_training_maxes, l.before_row)).* from public.training_max_recompute_log l where l.before_row is not null;",
      "drop table if exists public.training_max_recompute_log;",
      "drop function if exists public.client_exercise_rollup(uuid, uuid);",
      "drop function if exists public.recompute_training_maxes(uuid, text);",
      fnFromMigration("0359", "recompute_training_max"),
      fnFromMigration("0329", "complete_workout_session"),
      fnFromMigration("0371", "set_unclear_point_counted"),
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 122 misbehaves. Puts the training maxes back to what they were before the rebuild, and puts back the old trigger, the old personal-record check and the old Count it function.",
    rows: [
      ["0372 is not already applied (no rollup function yet)", "to_regprocedure('public.client_exercise_rollup(uuid, uuid)') is null"],
      ["0371 is applied (the unclear-point mark exists)", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag')"],
      ["the training maxes table and the completion function exist", "to_regclass('public.athlete_training_maxes') is not null and to_regprocedure('public.complete_workout_session(uuid)') is not null"],
    ],
  },
  {
    n: "123",
    slug: "0373",
    title: "0373 The Progress tab: your card and graph choices, pinned exercises, and the daily calories a client logged",
    migrations: ["0373"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then the Progress tab shows the estimated maxes as cards, remembers your cards or list and weight or volume choice on your account, lets you pin an exercise to the front of a client's cards, and draws one graph of body weight with the calorie target and what the client logged.",
    undo: "drop function if exists public.client_daily_intake(uuid, uuid);" + String.fromCharCode(10) + "drop table if exists public.client_progress_pins;" + String.fromCharCode(10) + "drop table if exists public.coach_progress_prefs;",
    undoWhy: "Only if step 123 misbehaves. Removes the pins and the saved card choices (the Progress tab then uses its defaults).",
    rows: [
      ["0373 is not already applied (no pins table yet)", "to_regclass('public.client_progress_pins') is null"],
      ["the food log table exists", "to_regclass('public.food_log_entries') is not null"],
      ["the org wall check exists", "to_regprocedure('public.group_in_active_org(uuid)') is not null"],
    ],
  },
  {
    n: "124",
    slug: "0374",
    title: "0374 A coach can ask a client to count a record from imported history as a real one",
    migrations: ["0374"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then a coach can tap Make this PR count on a record found in imported history; the client gets one notification and a one-tap yes. On yes that one imported workout gets a workout log dated when it was done, so the record shows everywhere like any other, with its original date. A workout log dated more than a day ago no longer brings an inactive client back.",
    undo: [
      "delete from public.notifications where type = 'pr_promotion';",
      "drop function if exists public.answer_pr_promotion(uuid, boolean);",
      "drop function if exists public.ask_pr_promotion(uuid, text);",
      "drop table if exists public.pr_promotions;",
      fnFromMigration("0281", "resurface_inactive_client"),
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 124 misbehaves. Removes the asks and the notifications about them and puts back the old rule for bringing an inactive client back. It does NOT remove a workout log already made by a yes (that is real history now).",
    rows: [
      ["0374 is not already applied (no promotions table yet)", "to_regclass('public.pr_promotions') is null"],
      ["the notifications table and the inactive-client rule exist", "to_regclass('public.notifications') is not null and to_regprocedure('public.resurface_inactive_client()') is not null"],
      ["the org wall check exists", "to_regprocedure('public.group_in_active_org(uuid)') is not null"],
    ],
  },
  {
    n: "125",
    slug: "0375",
    title: "0375 InBody scans from a photo of the result sheet: the scans, a private place for the photos, and the one function that saves a scan",
    migrations: ["0375"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then a client (next to where they log body weight) or a coach can photograph an InBody sheet, check the numbers the app read from it, and save the scan; the photo is kept privately for the client and their coaches, and the scan feeds the graphs. A scan's weight becomes that day's weigh-in only when asked and never over one already logged.",
    undo: [
      "drop function if exists public.save_body_scan(uuid, uuid, jsonb, text, boolean);",
      'drop policy if exists "inbody_scans_storage_select" on storage.objects;',
      'drop policy if exists "inbody_scans_storage_insert" on storage.objects;',
      'drop policy if exists "inbody_scans_storage_delete" on storage.objects;',
      "drop table if exists public.body_scans;",
    ].join(String.fromCharCode(10)),
    undoWhy: "Only if step 125 misbehaves. Removes the scans and the function. The private photo bucket and any photos already in it are left where they are (nobody can read them without the policies).",
    rows: [
      ["0375 is not already applied (no scans table yet)", "to_regclass('public.body_scans') is null"],
      ["body weight logs and the athlete-in-group rule exist", "to_regclass('public.body_weight_logs') is not null and to_regprocedure('public.enforce_athlete_in_group()') is not null"],
      ["the org wall check exists", "to_regprocedure('public.group_in_active_org(uuid)') is not null"],
    ],
  },
  {
    n: "126",
    slug: "0376",
    title: "0376 The health screening line on a client's Overview stays gone once acknowledged, until a new flagged answer",
    migrations: ["0376"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until the code that goes with it is live. Then a flagged health screening shows once on the client's Overview as Health screening: N flagged with an Acknowledge button; after that it stays gone until the client has more flagged answers. The answers stay under Billing & settings.",
    undo: "alter table public.athlete_injury_flag_acknowledgements drop column if exists flagged_count;",
    undoWhy: "Only if step 126 misbehaves. Removes the saved number (the line then shows again for every client with a flagged answer).",
    rows: [
      ["0376 is not already applied (no count column yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_injury_flag_acknowledgements' and column_name = 'flagged_count')"],
      ["the acknowledgements table exists", "to_regclass('public.athlete_injury_flag_acknowledgements') is not null"],
    ],
  },
  {
    n: "127",
    slug: "0377",
    title: "0377 A library exercise can never be named with only numbers or with its sets and reps",
    migrations: ["0377"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen. From now on the library refuses a new exercise or a rename whose name is only digits, commas, dots and spaces (1, 8,8,8, 20) or that carries its sets and reps (Sumo Squat 3x10, Squat 3 sets, Row @7), and an alias cannot point to such a name. Names such as 5/3/1, 21s, Day 1 and Hex Bar Deadlift are fine. The rows already there are not touched or deleted.",
    undo: "alter table public.exercise_library drop constraint if exists exercise_library_name_not_digits;\nalter table public.exercise_aliases drop constraint if exists exercise_aliases_target_not_digits;",
    undoWhy: "Only if step 127 misbehaves. Removes the rule; nothing else changes.",
    rows: [
      ["0377 is not already applied (no rule yet)", "not exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass)"],
      ["the exercise library and the aliases exist", "to_regclass('public.exercise_library') is not null and to_regclass('public.exercise_aliases') is not null"],
    ],
  },
  {
    n: "128",
    slug: "0378",
    title: "0378 Moving a client to another group moves all of their records",
    migrations: ["0378"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen until a client is moved. After that, the client's intake form, photos, goals, nutrition phases, check-ins, food log, body scans, consent, credit ledger and every other record of theirs go to the new group with them, instead of staying behind in the old one. The old group's own structures (who attended its group sessions, its package access, kiosk PINs and check-ins, game scores) stay.",
    undo: fnFromMigration("0340", "move_client_to_group"),
    undoWhy: "Only if step 128 misbehaves. Puts back the earlier function that moves only sixteen tables. Records that were already moved stay moved.",
    rows: [
      ["0378 is not already applied (the move does not yet find every table)", "to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)') is not null and pg_get_functiondef(to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)')) not like '%information_schema.columns%'"],
      ["the session coach notes and progression rules tables exist", "to_regclass('public.session_coach_notes') is not null and to_regclass('public.exercise_progressions') is not null"],
    ],
  },
  {
    n: "129",
    slug: "0379",
    title: "0379 A program day or logged session exercise can never be named with only numbers or with its sets and reps",
    migrations: ["0379"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen. From now on a program day or a logged session refuses an exercise whose name is only digits, commas, dots and spaces (10,10,10) or that carries its sets and reps (Sumo Squat 3x10). The rows already there (77 logged exercises and 1 program exercise) are not touched or deleted; an edit to one of those rows is refused until it is renamed or removed.",
    undo: "alter table public.group_workout_exercises drop constraint if exists group_workout_exercises_name_not_digits;\nalter table public.session_exercises drop constraint if exists session_exercises_name_not_digits;",
    undoWhy: "Only if step 129 misbehaves. Removes the two rules; nothing else changes.",
    rows: [
      ["0379 is not already applied (no rules yet)", "not exists (select 1 from pg_constraint where conname in ('group_workout_exercises_name_not_digits', 'session_exercises_name_not_digits'))"],
      ["the program exercises and session exercises tables exist", "to_regclass('public.group_workout_exercises') is not null and to_regclass('public.session_exercises') is not null"],
    ],
  },
  {
    n: "130",
    slug: "renumber-johann-program-days",
    title: "give each day of the program 'Dont mess with the Johann' its own day number (its Day 1 and Day 2 both carry the number 1), keeping the order you see today; undoable",
    migrations: [],
    warn: "A one-time data change to ONE program (a7b5f600-3b62-4ec0-a016-d518f3f39a3e): it only changes the day numbers of its four days, in the order they show today (Day 1, Day 2, Day 3, Day 4 become numbers 1, 2, 3, 4). Nothing is deleted. It stops with nothing changed if the program does not look exactly like that.",
    sees: "Success. No rows returned.",
    afterwards: "That program's four days keep their names and exercises and now each has its own day number. Step 131 (a day number is unique inside a week) needs this done first.",
    bodySql: "update public.workouts w set day_index = r.rn\nfrom (select id, row_number() over (partition by week_number order by day_index, created_at) as rn from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e') r\nwhere w.id = r.id and w.program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and w.day_index <> r.rn;",
    undo: "update public.workouts set day_index = 1 where id in ('0f92ad85-c134-4731-b027-446254949a76', 'fd73bdb4-1510-4b32-a521-219222921c12');\nupdate public.workouts set day_index = 2 where id = '27c5131f-b421-4eeb-b2e4-3291ce60d67c';\nupdate public.workouts set day_index = 3 where id = '33a67f22-e93d-4585-849f-c9894d0bc89f';",
    undoWhy: "Only if the renumbering was wrong. Puts the four day numbers back as they were (1, 1, 2, 3). Undo step 131 first if it has been applied.",
    rows: [
      ["the program has exactly the four days it had, and two of them share day number 1", "(select count(*) from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e') = 4 and (select count(*) from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and week_number = 1 and day_index = 1) = 2"],
      ["step 130 is not already applied (the days do not already have 1, 2, 3, 4)", "exists (select 1 from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and day_index = 1 group by week_number having count(*) = 2)"],
    ],
  },
  {
    n: "131",
    slug: "0380",
    title: "0380 A day number is unique inside a week of a program",
    migrations: ["0380"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen. From now on two days of one program cannot get the same week and day number at the same moment; the app picks the next free number and tries again if it loses a race.",
    undo: "alter table public.workouts drop constraint if exists workouts_program_week_day_key;",
    undoWhy: "Only if step 131 misbehaves. Removes the rule; nothing else changes.",
    rows: [
      ["0380 is not already applied (the rule is not there yet)", "not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass)"],
      ["no program has two days with the same week and day number (run step 130 first if this says false)", "not exists (select 1 from public.workouts group by program_id, week_number, day_index having count(*) > 1)"],
    ],
  },
  {
    n: "132",
    slug: "0381",
    title: "0381 A one-on-one space's name follows its client's name when the client's name is corrected",
    migrations: ["0381"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes now. From now on, when a client's name is changed, their one-on-one space is renamed with it, but only if the space still carried the old name exactly. The three spaces whose names already differ from their client (Jeff Z, Johann Gorsik, Ronnie Arnold) are not touched.",
    undo: "drop trigger if exists profiles_sync_one_on_one_group_name on public.profiles;\ndrop function if exists public.sync_one_on_one_group_name();",
    undoWhy: "Only if step 132 misbehaves. Removes the trigger and its function; names already changed stay.",
    rows: [
      ["0381 is not already applied (the function is not there yet)", "to_regprocedure('public.sync_one_on_one_group_name()') is null"],
      ["the profiles and groups tables exist", "to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null"],
    ],
  },
  {
    n: "133",
    slug: "0382",
    title: "0382 Minors and health closures: children are never shown to or matched with other members, parent-link secrets are made by the database and need verified consent, believable weigh-ins, images-only scan photos, bounded scan saves",
    migrations: ["0382"],
    sees: "Success. No rows returned.",
    afterwards: "A child, or someone with no birthdate on file, no longer appears in the Training partners list of other members of their organization and cannot switch their own profile to visible; partner messages are limited to 500 characters and ten requests an hour; a parent-view link can only be made after parental consent is verified and its secret is made by the database; a weigh-in must be between 20 and 1500; the InBody photo bucket takes jpeg, png and webp only; saving a scan checks its date and size; and a coach can be told that a child under 13 is waiting for consent. Existing rows are not touched.",
    undo: [
      "drop trigger if exists training_partner_requests_hourly_limit on public.training_partner_requests;",
      "drop function if exists public.limit_training_partner_requests();",
      "alter table public.training_partner_requests drop constraint if exists training_partner_requests_text_limits;",
      "alter table public.training_partner_profiles drop constraint if exists training_partner_profiles_text_limits;",
      "drop policy if exists \"training_partner_requests_insert_own\" on public.training_partner_requests;",
      "create policy \"training_partner_requests_insert_own\" on public.training_partner_requests for insert to authenticated with check ((from_athlete_id = (select auth.uid())) and (not public.training_partners_mutually_blocked(to_athlete_id, (select auth.uid()))) and (public.training_partners_share_org(to_athlete_id, (select auth.uid())) or (public.training_partners_cross_org_enabled() and (not public.training_partner_is_restricted(to_athlete_id)) and (not public.training_partner_is_restricted((select auth.uid()))))));",
      "drop policy if exists \"training_partner_profiles_write_own\" on public.training_partner_profiles;",
      "create policy \"training_partner_profiles_write_own\" on public.training_partner_profiles for all to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));",
      "drop policy if exists \"training_partner_profiles_select_visible\" on public.training_partner_profiles;",
      "create policy \"training_partner_profiles_select_visible\" on public.training_partner_profiles for select to authenticated using ((visible = true) and (not public.training_partners_mutually_blocked(athlete_id, (select auth.uid()))) and (public.training_partners_share_org(athlete_id, (select auth.uid())) or (public.training_partners_cross_org_enabled() and (not public.training_partner_is_restricted(athlete_id)) and (not public.training_partner_is_restricted((select auth.uid()))))));",
      "drop function if exists public.training_partner_is_protected(uuid);",
      "drop trigger if exists guardian_links_set_token on public.guardian_links;",
      "drop function if exists public.set_guardian_link_token();",
      "alter table public.guardian_links alter column access_token drop default;",
      fnFromMigration("0338", "guardian_link_allowed"),
      "alter table public.body_weight_logs drop constraint if exists body_weight_logs_weight_range;",
      "update storage.buckets set allowed_mime_types = null where id = 'inbody-scans';",
      fnFromMigration("0375", "save_body_scan"),
      "delete from public.notifications where type = 'minor_consent_needed';",
      "alter table public.notifications drop constraint if exists notifications_type_check;",
      "alter table public.notifications add constraint notifications_type_check check (type = any (array['booking_request', 'comment', 'credits_expired', 'direct_message', 'email_changed', 'goal_answered', 'goal_proposed', 'gym_visitor_lead', 'late_change', 'macros_assigned', 'meal_plan_try', 'milestone_celebration', 'new_training_block', 'nutrition_allergies_updated', 'nutrition_baseline_ready', 'nutrition_preferences_changed', 'nutrition_prompt_answered', 'nutrition_target_changed', 'partner_request', 'partner_request_accepted', 'pr_promotion', 'program_assigned', 'recurring_booking_conflict', 'request_decision', 'schedule_applied', 'schedule_request', 'schedule_resumed', 'session_pattern_note', 'trainer_dispatch_offer', 'trainer_dispatch_question', 'waitlist_slot_offered']));",
    ].join("\n"),
    undoWhy: "Only if step 133 misbehaves. Puts back the earlier training-partner rules, the browser-chosen link secret, the earlier link and scan functions, and the earlier notification types (any child-consent notices are removed).",
    rows: [
      ["0382 is not already applied (the new helper is not there yet)", "to_regprocedure('public.training_partner_is_protected(uuid)') is null"],
      ["the tables and helpers it builds on exist", "to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.guardian_links') is not null and to_regclass('public.body_scans') is not null and to_regclass('public.minor_consent') is not null and to_regprocedure('public.training_partner_is_minor(uuid)') is not null and to_regprocedure('public.training_partner_intake_incomplete(uuid)') is not null"],
      ["no existing weigh-in is outside 20 to 1500 (so the new rule fits what is saved)", "not exists (select 1 from public.body_weight_logs where weight < 20 or weight > 1500)"],
    ],
  },
  {
    n: "134",
    slug: "0383",
    title: "0383 A text STOP is remembered for the phone number: nobody can opt in with it, and no text goes to it, until it texts START",
    migrations: ["0383"],
    sees: "Success. No rows returned.",
    afterwards: "Nothing changes on screen. Numbers that already stopped are carried over into a new private list. From now on a STOP reply is remembered for the number even if nobody had opted in with it, a number on the list cannot be used to opt in (the person is told to text START from it), and no text is sent to it.",
    undo: [
      fnFromMigration("0229", "record_sms_stop"),
      fnFromMigration("0229", "record_sms_start"),
      fnFromMigration("0229", "sms_consent_for_dispatch"),
      fnFromMigration("0229", "set_sms_consent"),
      "drop table if exists public.sms_suppressed_numbers;",
    ].join("\n"),
    undoWhy: "Only if step 134 misbehaves. Puts back the earlier text functions and removes the list of stopped numbers (a STOP then only affects clients who had opted in with that number).",
    rows: [
      ["0383 is not already applied (the stopped-number list is not there yet)", "to_regclass('public.sms_suppressed_numbers') is null"],
      ["the text consent table and functions exist", "to_regclass('public.athlete_sms_consent') is not null and to_regprocedure('public.record_sms_stop(text)') is not null and to_regprocedure('public.set_sms_consent(text, boolean, boolean, text)') is not null"],
    ],
  },
  {
    n: "135",
    slug: "0384",
    title: "0384 Privacy closures: shared lists changed only by their owner, private clients stay private from organization admins, ten more client tables refuse a row about a non-member, progress photos in the owner's folder, an audit trail for access-changing rows",
    migrations: ["0384"],
    sees: "Success. No rows returned.",
    afterwards: "A coach can no longer change or delete another coach's food mappings or movement tags (they can still add their own). A client marked private from the organization is no longer visible to organization admins in their billing rate, set-aside and reinstated-session records, schedule requests, or (for a private one-on-one space) the space itself, its posts and its events, and an admin can no longer set such a client aside or hold, give back or take back their expired sessions. Ten more client tables refuse a row about someone who is not in the group; a progress photo must sit in its owner's own folder; and changes to organizations, memberships, consent, parent links, kiosk PINs, API keys and legal acceptances are written to the audit trail (never a PIN or key value).",
    undo: [
      "drop trigger if exists organizations_audit on public.organizations;",
      "drop trigger if exists group_memberships_audit on public.group_memberships;",
      "drop trigger if exists organization_memberships_audit on public.organization_memberships;",
      "drop trigger if exists minor_consent_audit on public.minor_consent;",
      "drop trigger if exists guardian_links_audit on public.guardian_links;",
      "drop trigger if exists kiosk_pins_audit on public.kiosk_pins;",
      "drop trigger if exists coach_api_keys_audit on public.coach_api_keys;",
      "drop trigger if exists legal_acceptances_audit on public.legal_acceptances;",
      "drop policy if exists \"progress_photos_write_own\" on public.progress_photos;",
      "create policy \"progress_photos_write_own\" on public.progress_photos for all to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));",
      "drop trigger if exists athlete_notes_enforce_athlete_in_group on public.athlete_notes;",
      "drop trigger if exists client_ai_notes_enforce_athlete_in_group on public.client_ai_notes;",
      "drop trigger if exists client_progress_pins_enforce_athlete_in_group on public.client_progress_pins;",
      "drop trigger if exists session_pattern_checks_enforce_athlete_in_group on public.session_pattern_checks;",
      "drop trigger if exists pro_shop_link_day_pins_enforce_athlete_in_group on public.pro_shop_link_day_pins;",
      "drop trigger if exists coach_video_checkin_action_items_enforce_athlete_in_group on public.coach_video_checkin_action_items;",
      "drop trigger if exists guardian_links_enforce_athlete_in_group on public.guardian_links;",
      "drop trigger if exists workout_logs_enforce_athlete_in_group on public.workout_logs;",
      "drop trigger if exists progress_photos_enforce_athlete_in_group on public.progress_photos;",
      "drop trigger if exists food_log_entries_enforce_athlete_in_group on public.food_log_entries;",
      fnFromMigration("0281", "set_client_inactive"),
      fnFromMigration("0280", "set_credit_expiry_hold"),
      fnFromMigration("0280", "reinstatable_expired_credits"),
      fnFromMigration("0280", "reinstate_expired_credits"),
      fnFromMigration("0280", "undo_expired_reinstatement"),
      "drop policy if exists \"group_sessions_select_event_member\" on public.group_sessions;",
      "create policy \"group_sessions_select_event_member\" on public.group_sessions for select to authenticated using ((kind = 'event') and (public.is_group_member(group_id) or public.is_org_admin_of_group(group_id)));",
      "drop policy if exists \"posts_delete_own_or_coach\" on public.posts;",
      "create policy \"posts_delete_own_or_coach\" on public.posts for delete to authenticated using ((author_id = (select auth.uid())) or public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));",
      "drop policy if exists \"posts_select_members\" on public.posts;",
      "create policy \"posts_select_members\" on public.posts for select to authenticated using (public.is_group_member(group_id) or public.is_org_admin_of_group(group_id));",
      "drop policy if exists \"groups_select_members_or_org_admin\" on public.groups;",
      "create policy \"groups_select_members_or_org_admin\" on public.groups for select to authenticated using (public.is_group_member(id) or public.is_org_admin_of_group(id));",
      "drop policy if exists \"schedule_request_notes_select_coaches\" on public.schedule_request_notes;",
      "create policy \"schedule_request_notes_select_coaches\" on public.schedule_request_notes for select to authenticated using (exists (select 1 from public.schedule_requests r where r.id = schedule_request_notes.request_id and (public.is_group_coach(r.group_id) or public.is_org_admin_of_group(r.group_id))));",
      "drop policy if exists \"schedule_requests_select_participants\" on public.schedule_requests;",
      "create policy \"schedule_requests_select_participants\" on public.schedule_requests for select to authenticated using ((athlete_id = (select auth.uid())) or public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));",
      "drop policy if exists \"client_inactive_events_select_coach\" on public.client_inactive_events;",
      "create policy \"client_inactive_events_select_coach\" on public.client_inactive_events for select to authenticated using (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));",
      "drop policy if exists \"client_inactive_select_coach\" on public.client_inactive;",
      "create policy \"client_inactive_select_coach\" on public.client_inactive for select to authenticated using (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));",
      "drop policy if exists \"client_billing_rates_org_admin_select\" on public.client_billing_rates;",
      "create policy \"client_billing_rates_org_admin_select\" on public.client_billing_rates for select to authenticated using (public.is_org_admin_of_group(group_id));",
      "drop function if exists public.is_group_private_from_org(uuid);",
      "drop policy if exists \"exercise_biomech_tags_insert_coach\" on public.exercise_biomech_tags;",
      "drop policy if exists \"exercise_biomech_tags_update_own\" on public.exercise_biomech_tags;",
      "drop policy if exists \"exercise_biomech_tags_delete_own\" on public.exercise_biomech_tags;",
      "create policy \"exercise_biomech_tags_write_coach\" on public.exercise_biomech_tags for all to authenticated using (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')) with check (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));",
      "drop policy if exists \"builtin_ingredient_usda_mappings_insert_coach\" on public.builtin_ingredient_usda_mappings;",
      "drop policy if exists \"builtin_ingredient_usda_mappings_update_own\" on public.builtin_ingredient_usda_mappings;",
      "drop policy if exists \"builtin_ingredient_usda_mappings_delete_own\" on public.builtin_ingredient_usda_mappings;",
      "create policy \"builtin_ingredient_usda_mappings_write_coach\" on public.builtin_ingredient_usda_mappings for all to authenticated using (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')) with check (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));",
    ].join("\n"),
    undoWhy: "Only if step 135 misbehaves. Puts back the earlier rules and functions exactly, removes the new triggers and the audit triggers. Rows already written to the audit trail stay (it is append-only).",
    rows: [
      ["0384 is not already applied (the private-space helper is not there yet)", "to_regprocedure('public.is_group_private_from_org(uuid)') is null"],
      ["the tables and helpers it builds on exist", "to_regclass('public.builtin_ingredient_usda_mappings') is not null and to_regclass('public.exercise_biomech_tags') is not null and to_regclass('public.client_inactive') is not null and to_regclass('public.schedule_requests') is not null and to_regclass('public.progress_photos') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.enforce_athlete_in_group()') is not null and to_regprocedure('public.audit_watch()') is not null"],
      ["every existing progress photo already sits in its owner's folder (so the new rule fits what is saved)", "not exists (select 1 from public.progress_photos where storage_path not like athlete_id::text || '/%')"],
    ],
  },
];

STEPS.push({
  n: "136",
  slug: "0385",
  title: "0385 The kind of each set (warm-up, working, as-many-as-possible, back-off, drop); a warm-up or drop set never counts toward a goal, a record or a training max; records are per number of reps and a longer hold is a record; a training max comes only from a set of 1 to 8 reps",
  migrations: ["0385"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen at first. Every set already logged is a working set. From now on a client can tap a set number to mark it a warm-up; a warm-up or drop set no longer sets a record or a training max. A personal record now means no earlier set was at least as heavy for at least as many reps, and for a hold a longer time is the record (holds get their own record field, and each group's old shortest-hold record is replaced by its real longest hold). A training max is estimated only from sets of 1 to 8 reps. Marking a saved set a warm-up rebuilds that exercise's training max.",
  undo: [
    "drop trigger if exists set_logs_set_type_recompute on public.set_logs;",
    "drop function if exists public.recompute_on_set_type_change();",
    fnFromMigration("0372", "recompute_training_maxes"),
    "drop function if exists public.recompute_training_maxes_internal(uuid, text);",
    fnFromMigration("0372", "recompute_training_max"),
    fnFromMigration("0372", "complete_workout_session"),
    "delete from public.exercise_records where tracked_field = 'hold_seconds';",
    "alter table public.set_logs drop constraint if exists set_logs_set_type_check;",
    "alter table public.set_logs drop column if exists set_type;",
    "alter table public.group_workout_exercise_sets drop constraint if exists group_workout_exercise_sets_set_type_check;",
    "alter table public.group_workout_exercise_sets drop column if exists set_type;",
  ].join("\n"),
  undoWhy: "Only if step 136 misbehaves. Run it ONLY while the Release C code is not live (or after that code has been rolled back): the app writes the set type, and it fails once the column is gone. Puts back the earlier training-max, record and workout-completion functions exactly, removes the set-type columns (every set is then an ordinary set again) and removes the new hold records. The old shortest-hold records that step 136 replaced are not brought back (they were the wrong way round).",
  rows: [
    ["0385 is not already applied (the set-type column is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'set_type')"],
    ["the functions it replaces exist", "to_regprocedure('public.recompute_training_maxes(uuid, text)') is not null and to_regprocedure('public.recompute_training_max()') is not null and to_regprocedure('public.complete_workout_session(uuid)') is not null"],
    ["the imported-history flag it builds on exists", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag')"],
  ],
});

STEPS.push({
  n: "137",
  slug: "0386",
  title: "0386 A client's health form and waiver are finished by the server, never by the browser; a coach's decision on a flagged screening is kept",
  migrations: ["0386"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen, and the old health form keeps working: this step only adds the guard function (not yet switched on, see step 140) and the places where a coach's decision on a flagged health screening is kept (cleared, train with changes, hold, and a note). It is safe to run before the new code is live.",
  undo: [
    "drop trigger if exists client_intake_guard_completion on public.client_intake;",
    "drop function if exists public.client_intake_guard_completion();",
    "alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_decision_check;",
    "alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_note_length;",
    "alter table public.athlete_injury_flag_acknowledgements drop column if exists decision;",
    "alter table public.athlete_injury_flag_acknowledgements drop column if exists note;",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 137 misbehaves. Removes the guard function (and its switch, step 140, if that was run) and the coach decision columns (decisions already written are lost with them).",
  rows: [
    ["0386 is not already applied (the guard function is not there yet)", "to_regprocedure('public.client_intake_guard_completion()') is null"],
    ["the tables it builds on exist", "to_regclass('public.client_intake') is not null and to_regclass('public.athlete_injury_flag_acknowledgements') is not null"],
  ],
});

STEPS.push({
  n: "141",
  slug: "0389",
  title: "0389 Release G: the app at 1,500 clients (last-active, unseen and digest counts done by the database, indexes), real values only in sets, a test-organization mark, and a way to pause forgotten workouts",
  migrations: ["0389"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen. Pages and nightly jobs that read every client of a big coach can now ask the database for the answer. A set can no longer be saved with a weight over 2,000, reps over 1,000, an effort (RPE) outside 0 to 10, a time over two days or a distance over 5,000,000 (a row already flagged unclear is exempt); the few rows that break this today are flagged unclear, not changed or deleted. The sandbox organization is marked as a test. A workout left 'in progress' for three days, with no set saved in that time and not resumed in it, can be paused by the nightly job (the code that calls it ships with the release); resuming a paused workout now notes when it was resumed. Safe to run before the code is live.",
  undo: [
    "drop function if exists public.close_stale_sessions(integer);",
    "alter table public.athlete_sessions drop column if exists resumed_at;",
    "alter table public.organizations drop column if exists is_test;",
    "alter table public.set_logs drop constraint if exists set_logs_values_in_range;",
    "drop index if exists public.ai_usage_log_created_idx;",
    "drop index if exists public.set_logs_completed_at_idx;",
    "drop index if exists public.nutrition_checkins_group_created_idx;",
    "drop index if exists public.bookings_group_start_idx;",
    "drop index if exists public.credit_purchases_group_created_idx;",
    "drop index if exists public.workout_logs_group_created_idx;",
    "drop index if exists public.workout_logs_group_athlete_created_idx;",
    "drop function if exists public.coach_digest_activity(uuid, uuid[]);",
    "drop function if exists public.coach_unseen_groups(uuid[]);",
    "drop function if exists public.business_last_active(uuid[]);",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 141 misbehaves. Run it only while the Release G code is not live (the Business page, Home and the nightly digest call the three count functions and would show a load error without them). Removes the functions, the indexes, the value rule on sets and the test mark. Sets that step 141 flagged unclear stay flagged (a coach can accept them in Unclear data points); workouts it paused stay paused.",
  rows: [
    ["0389 is not already applied (the last-active function is not there yet)", "to_regprocedure('public.business_last_active(uuid[])') is null"],
    ["the tables it builds on exist", "to_regclass('public.workout_logs') is not null and to_regclass('public.coach_view_state') is not null and to_regclass('public.set_logs') is not null and to_regclass('public.athlete_sessions') is not null and to_regclass('public.organizations') is not null and to_regclass('public.ai_usage_log') is not null"],
    ["set_logs has the unclear flag (0371) the value rule leans on", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag')"],
  ],
});

STEPS.push({
  n: "147",
  slug: "0395",
  title: "0395 Release K1: push notifications that respect the person (quiet hours, private lock screen), a mark on each notice for the five-minute push job, and a payment notice type",
  migrations: ["0395"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release K1 code is live. Adds three small settings on each person (quiet hours start and end, private lock screen), a pushed-at mark on notices (every existing notice is marked as already handled, so nothing old is sent), and one more notice type for payments. Safe to run before the code is live.",
  undo: [
    "drop index if exists public.notifications_unpushed_idx;",
    "alter table public.notifications drop column if exists pushed_at;",
    "alter table public.profiles drop column if exists generic_push_text;",
    "alter table public.profiles drop column if exists quiet_hours_end;",
    "alter table public.profiles drop column if exists quiet_hours_start;",
    "-- the extra notification type is left in the list (removing it could break rows that use it)",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 147 misbehaves. Run it only while the Release K1 code is not live (Settings, the push sender and the push job use the columns). Quiet hours people set are lost.",
  rows: [
    ["0395 is not already applied (the pushed-at mark is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'pushed_at')"],
    ["the tables it builds on exist", "to_regclass('public.profiles') is not null and to_regclass('public.notifications') is not null"],
    ["the notification type rule exists to be widened", "exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)"],
  ],
});

STEPS.push({
  n: "146",
  slug: "0394",
  title: "0394 Release J: a new season for a team (the old group is retired and kept whole; the new one has the same positions, coaches and the athletes chosen)",
  migrations: ["0394"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release J code is live. Adds one empty column (when a group was retired) and two functions (start next season, bring a retired season back). Safe to run before the code is live.",
  undo: [
    "drop function if exists public.unarchive_group(uuid);",
    "drop function if exists public.start_new_season(uuid, text, uuid[]);",
    "alter table public.groups drop column if exists archived_at;",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 146 misbehaves. Run it only while the Release J code is not live (the coach's group lists, where people land and the Team page read the column). Seasons already started stay; the retired groups come back into every list.",
  rows: [
    ["0394 is not already applied (the retired-at column is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at')"],
    ["the tables it builds on exist", "to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.group_positions') is not null and to_regclass('public.audit_log') is not null"],
    ["the helper functions it uses exist", "to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null"],
  ],
});

STEPS.push({
  n: "145",
  slug: "0393",
  title: "0393 Release I: a coach can invite someone who already has an account to be their one-on-one client (they accept or decline), and the notification types the invite code writes are accepted",
  migrations: ["0393"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release I code is live. Adds one small table (invitations to a one-on-one space) and two functions (accept or decline, and the coach cancelling). It also adds three notification types to the list the database accepts: 'organization_invite' (the invite-a-coach code has written it since Release BD but the database refused it, so an existing account invited to an organization never got a notice), 'space_invite' and 'org_announcement'. Safe to run before the code is live.",
  undo: [
    "drop function if exists public.cancel_space_invite(uuid);",
    "drop function if exists public.answer_space_invite(uuid, boolean);",
    "drop table if exists public.space_invites;",
    "-- the three extra notification types are left in the list (removing them could break rows that use them)",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 145 misbehaves. Run it only while the Release I code is not live (Add client and the invitation page use the table and functions). Pending invitations are lost.",
  rows: [
    ["0393 is not already applied (the invitations table is not there yet)", "to_regclass('public.space_invites') is null"],
    ["the tables it builds on exist", "to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.notifications') is not null"],
    ["the notification type rule exists to be widened", "exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)"],
    ["the helper functions it uses exist", "to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_one_on_one_group(uuid)') is not null"],
  ],
});

STEPS.push({
  n: "144",
  slug: "0392",
  title: "0392 Release H: what a coach coaches (asked at signup) and an owner or admin choosing which coach holds a new client",
  migrations: ["0392"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release H code is live. Adds one empty column (what a coach coaches: one-on-one clients, a team or class, or a gym) and one function (the owner or admin choosing the coach of a new client). Safe to run before the code is live.",
  undo: [
    "drop function if exists public.assign_group_coach(uuid, uuid, boolean);",
    "alter table public.profiles drop column if exists coach_type;",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 144 misbehaves. Run it only while the Release H code is not live (signup, Settings and Add client read the column and call the function). Removes the column and the function.",
  rows: [
    ["0392 is not already applied (the coach type column is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'coach_type')"],
    ["the tables it builds on exist", "to_regclass('public.profiles') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.organization_memberships') is not null"],
    ["the helper functions it uses exist", "to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null"],
  ],
});

STEPS.push({
  n: "143",
  slug: "0391",
  title: "0391 Release H: getting out of an organization (remove a member and hand over their clients, leave, change a role, cancel or extend an invitation, close the organization)",
  migrations: ["0391"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release H code is live (the Team page calls these). Adds functions only; it replaces leave_organization with a version that can hand clients over (the old one-argument call still works). Safe to run before the code is live.",
  undo: [
    "drop function if exists public.close_organization(uuid);",
    "drop function if exists public.extend_org_invite(uuid);",
    "drop function if exists public.cancel_org_invite(uuid);",
    "drop function if exists public.set_org_member_role(uuid, uuid, text);",
    "drop function if exists public.remove_org_member(uuid, uuid, uuid);",
    "drop function if exists public.leave_organization(uuid, uuid);",
    "drop function if exists public._detach_coach_from_org(uuid, uuid, uuid, boolean);",
    "drop function if exists public._solo_org_for(uuid, uuid);",
    "-- then put the old one-argument leave_organization back by running step 0352 again (apply-step*-0352.sql)",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 143 misbehaves. Run it only while the Release H code is not live (the Team page and the Leave button call these). Removes the new functions; run the 0352 step again to bring the old Leave back. Organizations and groups already moved stay where they are.",
  rows: [
    ["0391 is not already applied (the remove function is not there yet)", "to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is null"],
    ["the tables it builds on exist", "to_regclass('public.organization_memberships') is not null and to_regclass('public.organization_invites') is not null and to_regclass('public.audit_log') is not null and to_regclass('public.bookings') is not null"],
    ["the helper functions it uses exist", "to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null"],
  ],
});

STEPS.push({
  n: "148",
  slug: "0396",
  title: "0396 Release L: a leaving coach is never given an organization (their clients stay where they are, they are marked leaving and choose); the finishing step is server-only",
  migrations: ["0396"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release L code is live. Adds one empty column (when a coach was marked leaving) and replaces the remove / leave / close organization steps so none of them creates an organization. A coach marked leaving keeps their clients exactly where they are. Safe to run before the code is live.",
  // Puts every function back exactly as it was before (the 0049, 0174, 0217, 0228 and 0391 versions), then removes what 0396 added, so nothing is left reading the new columns.
  undo: [
    // Coaches whose access already ended or who were let go are put back the way they were before the step: their seats in the groups they kept come back, and anyone let go is removed from the organization
    // (as the earlier step did), so nobody becomes an ordinary member by the undo.
    "insert into public.group_memberships (group_id, profile_id, role) select g.id, om.profile_id, 'coach' from public.organization_memberships om join public.groups g on g.id = any (om.departing_group_ids) and g.organization_id = om.organization_id where om.access_ended_at is not null and om.fired_at is null on conflict do nothing;",
    "delete from public.organization_memberships where fired_at is not null;",
    fnFromMigration("0350", "coach_in_org"),
    fnFromMigration("0049", "is_org_member"),
    fnFromMigration("0228", "org_coach_seats"),
    fnFromMigration("0228", "org_billable_clients"),
    LIVE_TRANSFER_ORGANIZATION_OWNERSHIP,
    fnFromMigration("0392", "assign_group_coach"),
    fnFromMigration("0391", "set_org_member_role"),
    fnFromMigration("0391", "_detach_coach_from_org"),
    fnFromMigration("0391", "close_organization"),
    "drop function if exists public.lift_departure_block(uuid, uuid);",
    "drop function if exists public._give_orphans_to_owner(uuid, uuid);",
    "drop function if exists public.end_departure_access(uuid, uuid);",
    "drop function if exists public._end_coach_access(uuid, uuid);",
    "drop function if exists public.remove_org_member(uuid, uuid, uuid, boolean);",
    fnFromMigration("0391", "remove_org_member"),
    "revoke execute on function public.remove_org_member(uuid, uuid, uuid) from public, anon;",
    "grant execute on function public.remove_org_member(uuid, uuid, uuid) to authenticated, service_role;",
    "-- the two extra notification kinds are left in the list (removing them could break rows that use them)",
    "drop policy if exists \"push_subscriptions_select_org_owner\" on public.push_subscriptions;",
    "create policy \"push_subscriptions_select_org_owner\" on public.push_subscriptions for select to authenticated using (exists (select 1 from public.organization_memberships om_owner join public.organization_memberships om_caller on om_caller.organization_id = om_owner.organization_id where om_owner.profile_id = push_subscriptions.profile_id and om_owner.role = 'owner' and om_caller.profile_id = (select auth.uid())));",
    "drop policy if exists \"org_memberships_select_self\" on public.organization_memberships;",
    "drop function if exists public.complete_departure(uuid, uuid);",
    "alter table public.organization_memberships drop column if exists export_failed_at, drop column if exists export_attempts, drop column if exists departing_org_name;",
    "-- the stored exports (bucket coach-exit-exports) are NOT removed here: the database refuses direct deletes in storage, so delete the files and the bucket in the Storage section of the dashboard if any exist",
    "alter table public.organization_memberships drop column if exists export_created_at, drop column if exists export_path, drop column if exists clients_notified_at;",
    "alter table public.organization_memberships drop column if exists closure_notified_at, drop column if exists reminded_1d_at, drop column if exists reminded_3d_at, drop column if exists departure_notified_at, drop column if exists access_ended_at, drop column if exists fired_at;",
    "alter table public.organization_memberships drop column if exists departing_group_ids;",
    "alter table public.organization_memberships drop column if exists departing_since;",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 148 misbehaves. Run it only while the Release L code is not live (the Team page, Home and the announcement read the column). Coaches already marked leaving lose the mark and become ordinary members of that organization again, still coaching the clients they kept.",
  rows: [
    ["0396 is not already applied (the leaving mark is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'departing_since')"],
    ["the offboarding steps it replaces exist (step 143 is applied)", "to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is not null and to_regprocedure('public._detach_coach_from_org(uuid, uuid, uuid, boolean)') is not null and to_regprocedure('public._solo_org_for(uuid, uuid)') is not null"],
    ["the audit writer exists", "to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null"],
    ["the notification type rule exists to be widened", "exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)"],
    ["the pieces it replaces exist (member check, seat count, ownership transfer, role change, owner push policy)", "to_regprocedure('public.is_org_member(uuid)') is not null and to_regprocedure('public.coach_in_org(uuid)') is not null and to_regprocedure('public.org_coach_seats(uuid)') is not null and to_regprocedure('public.transfer_organization_ownership(uuid, uuid)') is not null and to_regprocedure('public.set_org_member_role(uuid, uuid, text)') is not null and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_select_org_owner')"],
  ],
});

STEPS.push({
  n: "149",
  slug: "0397",
  title: "0397 Release F2: the free plan's client limit (15 training clients), installed SWITCHED OFF",
  migrations: ["0397"],
  sees: "Success. No rows returned.",
  afterwards: "Apply it after steps 146, 147 and 148 (it reads columns they add; the check above stops you otherwise). ONE thing changes at once: the client count in Plan and Billing (and so the bill) no longer counts a player who only sits in a retired past-season group, nor the clients of a group a leaving coach kept; an organization with neither sees the same number as before. Otherwise nothing changes: the limit is installed switched off (free_tier_clients_enforced returns false), so every organization behaves exactly as before. It is switched on later, together with billing, by one more short step. Safe to run before or after the code.",
  undo: [
    "drop trigger if exists group_memberships_free_tier_limit on public.group_memberships;",
    "drop function if exists public.free_tier_client_headroom(uuid);",
    fnFromMigration("0396", "org_billable_clients"),
    "drop function if exists public.enforce_free_tier_client_limit();",
    "drop function if exists public._org_training_clients(uuid);",
    "drop function if exists public._org_training_client_ids(uuid);",
    "drop function if exists public.org_is_free_tier(uuid);",
    "drop function if exists public.free_tier_clients_enforced();",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 149 misbehaves. Nothing else depends on it.",
  rows: [
    ["0397 is not already applied (the limit trigger is not there yet)", "not exists (select 1 from pg_trigger where tgname = 'group_memberships_free_tier_limit' and not tgisinternal)"],
    ["the tables it reads exist", "to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null and to_regclass('public.organizations') is not null and to_regclass('public.organization_billing') is not null"],
    ["the columns it counts with exist (step 146: archived groups, step 148: kept groups)", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'departing_group_ids')"],
  ],
});

STEPS.push({
  n: "161",
  slug: "0409",
  title: "0409 Release M1: failed payments, refunds and disputes are recorded and the coach is told (a ledger of money events, one new kind of notice, a platform report); no money moves",
  warn: "This REBUILDS the list of allowed notice kinds (adds one: payment_problem). It refuses to run if the live list cannot be read or would lose a kind, and changes nothing in that case.",
  migrations: ["0409"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release M1 code is live. Adds one table (payment_events: a record of each failed payment, refund and dispute Stripe reports, a coach reads their own groups') and a read-only report for the platform admin. It moves no money and changes no balance. After the code is live, switch on four more event types for the webhook in the Stripe dashboard (invoice.payment_failed, charge.refunded, charge.dispute.created, charge.dispute.closed).",
  undo: [
    "drop function if exists public.payment_reconciliation_report();",
    "drop table if exists public.payment_events;",
    "-- the extra notification kind is left in the list (removing it could break rows that use it)",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 161 misbehaves. Run it only while the Release M1 code is not live. The record of failed payments, refunds and disputes is dropped with the table.",
  rows: [
    ["0409 is not already applied (the money events table is not there yet)", "to_regclass('public.payment_events') is null"],
    ["the tables and helpers it uses exist", "to_regclass('public.groups') is not null and to_regclass('public.profiles') is not null and to_regclass('public.membership_subscriptions') is not null and to_regclass('public.group_memberships') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null"],
    ["the notification type rule exists to be widened", "exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)"],
  ],
});

STEPS.push({
  n: "150",
  slug: "0398",
  title: "0398 Release S1: a changed sign-in email must be confirmed by the new address first (waiting requests table)",
  migrations: ["0398"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen until the Release S1 code is live. Adds one empty table for sign-in email changes waiting for confirmation (nobody can read it from the app) and two new kinds of notice. Safe to run before the code is live.",
  undo: [
    "drop table if exists public.pending_email_changes;",
    "-- the two extra notification kinds are left in the list (removing them could break rows that use them)",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 150 misbehaves. Run it only while the Release S1 code is not live (changing a client's sign-in email reads this table). A change still waiting for confirmation is simply dropped.",
  rows: [
    ["0398 is not already applied (the waiting-requests table is not there yet)", "to_regclass('public.pending_email_changes') is null"],
    ["the tables it builds on exist", "to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null and to_regclass('public.notifications') is not null"],
    ["the notification type rule exists to be widened", "exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)"],
  ],
});

STEPS.push({
  n: "142",
  slug: "0390",
  title: "0390 Release H: undo a whole history import (every workout an import creates carries one batch id)",
  migrations: ["0390"],
  sees: "Success. No rows returned.",
  afterwards: "Nothing changes on screen. Imports made after the Release H code is live can be undone as one batch from the History page; imports made before have no batch and are still deleted one workout at a time. Adds one empty column and an index. Safe to run before the code is live.",
  undo: [
    "drop index if exists public.athlete_sessions_import_batch_idx;",
    "alter table public.athlete_sessions drop column if exists import_batch_id;",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 142 misbehaves. Run it only while the Release H code is not live (the import and the History page read and write the column). Removes the column; the imported workouts stay, they just can no longer be removed as one batch.",
  rows: [
    ["0390 is not already applied (the batch column is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id')"],
    ["the table it builds on exists", "to_regclass('public.athlete_sessions') is not null"],
  ],
});

STEPS.push({
  n: "140",
  slug: "0388",
  title: "0388 Switch on the guard: a signed-in person's browser can no longer finish its own health form or waiver (the server does)",
  warn: "Run this only AFTER the Release D code is live (the new health form calls the server). With the old form still showing it would refuse to save.",
  migrations: ["0388"],
  sees: "Success. No rows returned.",
  afterwards: "From now on the health form and waiver are finished only by the app's server: a signed-in person's browser can no longer mark its own form complete or write the answers and signed name (it can still change its date of birth).",
  undo: "drop trigger if exists client_intake_guard_completion on public.client_intake;",
  undoWhy: "Only if step 140 misbehaves. Switches the guard off again (the browser may then write the completion columns, as before Release D).",
  rows: [
    ["step 140 is not already applied (the guard trigger is not there yet)", "not exists (select 1 from pg_trigger where tgname = 'client_intake_guard_completion' and tgrelid = 'public.client_intake'::regclass)"],
    ["step 137 is applied (the guard function exists)", "to_regprocedure('public.client_intake_guard_completion()') is not null"],
  ],
});

STEPS.push({
  n: "138",
  slug: "flag-clients-without-intake",
  title: "HELD for Ron's word: require the health form and waiver of every client who has not finished one",
  warn: "DO NOT RUN until Ron says so. It changes what real clients see: each of them is sent to the health form the next time they open the app. Run check-intake-flag-list.sql first and read the names.",
  migrations: [],
  bodySql: "create table if not exists public.intake_flag_log (\n  profile_id uuid primary key references public.profiles(id) on delete cascade,\n  flagged_at timestamptz not null default now()\n);\nalter table public.intake_flag_log enable row level security;\nrevoke all on public.intake_flag_log from anon, authenticated;\nwith flagged as (\n  update public.profiles set intake_required = true\n  where id in (select p.id from public.profiles p\nwhere p.intake_required is not true\n  and exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'athlete')\n  and not exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'coach')\n  and not exists (select 1 from public.client_intake ci where ci.athlete_id = p.id and ci.completed_at is not null)\n  and not coalesce(p.is_platform_admin, false)\n  and not exists (select 1 from public.organization_memberships om where om.profile_id = p.id and om.role in ('owner', 'admin'))\n  and not exists (select 1 from public.group_memberships gx join public.groups gg on gg.id = gx.group_id where gx.profile_id = p.id and gg.organization_id = '50000000-0000-0000-0000-000000000001'))\n  returning id\n)\ninsert into public.intake_flag_log (profile_id) select id from flagged on conflict do nothing;",
  sees: "Success. No rows returned.",
  afterwards: "Every client who is not a coach anywhere and has no finished health form is asked to complete it the next time they open the app (before reaching anything else). Coaches, platform admins and clients who already finished are not touched. The people it flagged are listed in intake_flag_log so the undo can put exactly them back.",
  undo: "update public.profiles set intake_required = false where id in (select profile_id from public.intake_flag_log);\ndrop table if exists public.intake_flag_log;",
  undoWhy: "Puts back exactly the clients this step flagged (listed in intake_flag_log); nobody else is touched.",
  rows: [
    ["the column it sets exists", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'intake_required')"],
    ["the intake table exists", "to_regclass('public.client_intake') is not null"],
    ["step 138 is not already applied (the flag log is not there yet)", "to_regclass('public.intake_flag_log') is null"],
  ],
});

STEPS.push({
  n: "139",
  slug: "0387",
  title: "0387 Nothing about a person is public unless they chose it: a coach appears in Find a coach only after turning it on for themselves; a coach can add only their own clients to a challenge",
  migrations: ["0387"],
  sees: "Success. No rows returned.",
  afterwards: "No coach appears in Find a coach until each one turns on 'Show me in Find a coach' in Branding (every coach starts off, including coaches whose organization is already listed). A coach can no longer add a person who is not their client to a challenge.",
  undo: [
    "drop policy if exists \"challenge_participants_insert_self_or_coach\" on public.challenge_participants;",
    "create policy \"challenge_participants_insert_self_or_coach\" on public.challenge_participants for insert to authenticated with check (((profile_id = (select auth.uid())) and exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.status = 'active' and is_client_of_coach(c.coach_id))) or exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid())));",
    "alter table public.profiles drop constraint if exists profiles_marketplace_display_name_length;",
    "alter table public.profiles drop column if exists marketplace_display_name;",
    "alter table public.profiles drop column if exists marketplace_listed;",
  ].join(String.fromCharCode(10)),
  undoWhy: "Only if step 139 misbehaves. Puts back the earlier challenge rule and removes the personal listing columns (coaches in listed organizations are then shown as before).",
  rows: [
    ["0387 is not already applied (the personal listing column is not there yet)", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'marketplace_listed')"],
    ["the tables it builds on exist", "to_regclass('public.challenge_participants') is not null and to_regclass('public.challenges') is not null"],
  ],
});

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
  { id: "release-co", name: "Release CO (nothing about a person is public unless they chose it: personal Find a coach listing; a coach adds only their own clients to a challenge; run BEFORE the code that goes with it is live)", steps: ["139"] },
  { id: "release-cn-held", name: "HELD, Ron's word first: require the health form and waiver of every client without one (read check-intake-flag-list.sql first)", steps: ["138"] },
  { id: "release-cm", name: "Release CM (the guard function and a coach's decision on a flagged screening; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["137"] },
  { id: "release-m1-payment-events", name: "Release M1 (failed payments, refunds and disputes recorded and the coach told; adds one table and one notice kind, moves no money, safe before the code)", steps: ["161"] },
  { id: "release-s1-signin-hardening", name: "Release S1 (a changed sign-in email is confirmed by the new address; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["150"] },
  { id: "release-f2-client-cap", name: "Release F2 (the free plan's client limit, installed switched off; adds only)", steps: ["149"] },
  { id: "release-l-leaving-coach", name: "Release L (a leaving coach is never given an organization; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["148"] },
  { id: "release-k1-notifications", name: "Release K1 (quiet hours, private lock screen, payment and invite pushes; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["147"] },
  { id: "release-j-home-seasons", name: "Release J (a new season for a team; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["146"] },
  { id: "release-i-gym", name: "Release I (invite an existing account as a one-on-one client; invite notices that were being refused; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["145"] },
  { id: "release-h-importers", name: "Release H (undo a whole history import; getting out of an organization; what a coach coaches; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["142", "143", "144"] },
  { id: "release-g", name: "Release G (the app at 1,500 clients; real values only in sets; a test-organization mark; pause forgotten workouts; adds only, safe to run BEFORE the code that goes with it is live)", steps: ["141"] },
  { id: "release-cp", name: "Release CP (switch on the guard: the server finishes the health form and waiver; run AFTER the Release D code is live)", steps: ["140"] },
  { id: "release-cl", name: "Release CL (the kind of each set; records per number of reps; a warm-up or drop set never counts; run BEFORE the code that goes with it is live)", steps: ["136"] },
  { id: "release-d", name: "Release D", steps: ["32", "33", "34"] },
  { id: "release-f", name: "Release F", steps: ["35", "36", "37"] },
  { id: "release-h", name: "Release H (refund fix)", steps: ["38"] },
  { id: "release-i", name: "Release I (food preferences)", steps: ["39"] },
  { id: "release-j", name: "Release J (about you, baseline, phase of record)", steps: ["40"] },
  { id: "release-k", name: "Release K (recipe library)", steps: ["41"] },
  { id: "release-l", name: "Release L (schedule requests, Read during rest)", steps: ["42", "43"] },
  { id: "release-n", name: "Release N (nutrition tracking: food search, custom foods, nutrient detail)", steps: ["45", "46", "47", "48"] },
  { id: "release-o", name: "Release O (recalculation notice)", steps: ["51"] },
  { id: "release-o2", name: "Release O fix (close the notice function and the trigger functions; run any time after Release O)", steps: ["52", "53"] },
  { id: "release-p", name: "Release P (new training block notice)", steps: ["54"] },
  { id: "release-q", name: "Release Q (the coach's own name for an exercise)", steps: ["55"] },
  { id: "release-r", name: "Release R (a client can ask for a different meal plan)", steps: ["56"] },
  { id: "release-s", name: "Release S (booking hours check, grouped counts, hide demos per person, the away preset reply)", steps: ["57", "58", "59", "60"] },
  { id: "release-t", name: "Release T (a program copy remembers its source; a package can open a group)", steps: ["61", "62"] },
  { id: "release-u", name: "Release U (copy names no longer stack)", steps: ["63"] },
  { id: "release-v", name: "Release V (merge Coach Ron's duplicate exercises)", steps: ["64"] },
  { id: "release-w", name: "Release W (function search paths and the row-security helper)", steps: ["65"] },
  { id: "release-x", name: "Release X (image uploads: the missing look rules on three storage buckets)", steps: ["66"] },
  { id: "release-y", name: "Release Y (a coach's public website and featured shop cards)", steps: ["67"] },
  { id: "release-z", name: "Release Z (deleting a client no longer trips on records they created)", steps: ["68"] },
  { id: "release-ab", name: "Release AB (group events: In or Out, no session credit)", steps: ["69"] },
  { id: "release-ac", name: "Release AC (AI builder: a program the AI builds is a draft until the coach signs it off)", steps: ["70"] },
  { id: "release-ad", name: "Release AD (AI builder: it learns from the changes a coach makes; run AFTER Release AC)", steps: ["71"] },
  { id: "release-ae", name: "Release AE (AI builder: the optional conversation about how you program; run AFTER Release AD)", steps: ["72"] },
  { id: "release-af", name: "Release AF (a coach's own wording for the sign-in link email)", steps: ["73"] },
  { id: "release-aa", name: "Release AA (every session costs exactly 1 credit; the waitlist offer shows the coach's time zone)", steps: ["75"] },
  { id: "release-ah", name: "Release AH (only a real coach can have a public booking page or website)", steps: ["76"] },
  { id: "release-ai", name: "Release AI (a payment and its sessions are recorded in one step; run BEFORE the code that uses it deploys)", steps: ["77"] },
  { id: "release-ap", name: "Release AP (parent-view links only for under-13 clients of the coach, and they expire; internal training-partner functions closed; run any time)", steps: ["84"] },
  { id: "release-ao", name: "Release AO (assigning attaches a program only inside one organization; run any time, after Release AM)", steps: ["83"] },
  { id: "release-bm", name: "Release BM (imported history weights do not set training maxes; run BEFORE importing FitPros history)", steps: ["107"] },
  { id: "release-bn", name: "Release BN (adding a client works again: the creator of a new group can seat themselves; run any time, ideally NOW)", steps: ["108"] },
  { id: "release-bl", name: "Release BL (four exercises added to Coach Ron's library for the FitPros history; run any time)", steps: ["106"] },
  { id: "release-bk", name: "Release BK (move Coach Ron's own training into his personal space; run AFTER he has opened Coach Ron (you) once and removed the programs he does not want)", steps: ["105"] },
  { id: "release-bw", name: "Release BW (a rest can be a range such as 60-90; run AFTER Release BV and BEFORE the code that goes with it is live)", steps: ["117"] },
  { id: "release-ck", name: "Release CK (a text STOP sticks to the phone number; shared lists owner-only; private clients stay private from organization admins; ten more tables refuse non-member rows; audit trail for access-changing rows; run in order 134, 135, BEFORE the code that goes with it is live)", steps: ["134", "135"] },
  { id: "release-cj", name: "Release CJ (minors and health closures: training partners, parent links, weigh-ins, scan photos and saves, consent notice; run BEFORE the code that goes with it is live)", steps: ["133"] },
  { id: "release-ci", name: "Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live)", steps: ["130", "131", "132"] },
  { id: "release-ch", name: "Release CH (moving a client moves all of their records; program-day and session exercise names can never be only numbers or carry sets and reps; run BEFORE the code that goes with it is live)", steps: ["128", "129"] },
  { id: "release-cg", name: "Release CG (the exercise library refuses names made only of numbers; run BEFORE the code that goes with it is live)", steps: ["127"] },
  { id: "release-cf", name: "Release CF (a client's health screening line on Overview stays gone once acknowledged, until a new flagged answer; run BEFORE the code that goes with it is live)", steps: ["126"] },
  { id: "release-ce", name: "Release CE (InBody scans from a photo of the result sheet, with the photo kept in a private bucket; run BEFORE the code that goes with it is live)", steps: ["125"] },
  { id: "release-cd", name: "Release CD (a coach can ask a client to count a record from imported history as a real one; run BEFORE the code that goes with it is live)", steps: ["124"] },
  { id: "release-cc", name: "Release CC (the Progress tab: your card and graph choices, pinned exercises, and the daily calories a client logged; run BEFORE the code that goes with it is live)", steps: ["123"] },
  { id: "release-cb", name: "Release CB (imported history counts in totals, graphs, estimated maxes and records; training maxes are rebuilt from the sets; run AFTER Release CA, BEFORE the code that goes with it is live)", steps: ["122"] },
  { id: "release-ca", name: "Release CA (unclear data points in imported history are marked and kept out of the numbers; run BEFORE the code that goes with it is live)", steps: ["121"] },
  { id: "release-bz", name: "Release BZ (Needs attention: Not now for a week, and No macros for a client; run BEFORE the code that goes with it is live)", steps: ["120"] },
  { id: "release-by", name: "Release BY (the AI you can train, rules that apply only to the clients they fit, Past AI build notes for each client; run BEFORE the code that goes with it is live)", steps: ["119"] },
  { id: "release-bx", name: "Release BX (the one product shelf: where each package and Pro Shop card shows and who sees it; run BEFORE the code that goes with it is live)", steps: ["118"] },
  { id: "release-bv", name: "Release BV (template slots survive Duplicate; a program with a slot cannot be assigned to a client; run AFTER Release BU and BEFORE the code that goes with it is live)", steps: ["116"] },
  { id: "release-bu", name: "Release BU (pattern and class templates: a one-sided mark on ladder exercises, plus empty columns for slots and a client's level; run BEFORE the code that goes with it is live)", steps: ["115"] },
  { id: "release-bt", name: "Release BT (a group session belongs to one organization; run BEFORE the code that goes with it is live)", steps: ["114"] },
  { id: "release-bs", name: "Release BS (smaller goals under a client's goal; run BEFORE the code that goes with it is live)", steps: ["113"] },
  { id: "release-br", name: "Release BR (each storage bucket accepts only the file types its screen uploads; run any time)", steps: ["112"] },
  { id: "release-bq", name: "Release BQ (Coach Ron's exercise names merged and renamed, and the shared catalog filled from his library; run AFTER Release BP)", steps: ["111"] },
  { id: "release-bp", name: "Release BP (the shared exercise catalog, empty; run any time)", steps: ["110"] },
  { id: "release-bo", name: "Release BO (removes two empty stray Rob Derrick groups; run any time)", steps: ["109"] },
  { id: "release-bj", name: "Release BJ (a personal space for each person, outside any organization; run BEFORE the code that goes with it is live)", steps: ["104"] },
  { id: "release-bh", name: "Release BH (a one-time review request, a review link and client quotes; run BEFORE the code that goes with it is live)", steps: ["102"] },
  { id: "release-bg", name: "Release BG (coach assessments on a client's profile; run BEFORE the code that goes with it is live)", steps: ["101"] },
  { id: "release-bf", name: "Release BF (the money settings on organization memberships are the server's; shares never total over 100 percent; run BEFORE the code that goes with it is live)", steps: ["100"] },
  { id: "release-be", name: "Release BE (a coach can ask for notice before a client pauses or ends a schedule; run BEFORE the code that goes with it is live)", steps: ["99"] },
  { id: "release-bd", name: "Release BD (joining an organization needs the person's OK; invitations and leave; run BEFORE the code that goes with it is live)", steps: ["98"] },
  { id: "release-bc", name: "Release BC (Duplicate makes an unassigned library program; run BEFORE the code that goes with it is live)", steps: ["97"] },
  { id: "release-bb", name: "Release BB (Pro Shop links, referral partners, challenges, calendar entries, session types and discovery prospects per organization; run BEFORE the code that goes with it is live)", steps: ["96"] },
  { id: "release-ba", name: "Release BA (switch the organization-wall request header rule ON; run AFTER Release AZ and the code that sends the header)", steps: ["95"] },
  { id: "release-az", name: "Release AZ (defense in depth for the organization walls, installed switched off; run BEFORE the code that sends the header)", steps: ["94"] },
  { id: "release-ay", name: "Release AY (the daily briefing is made per organization; run BEFORE the code that goes with it is live)", steps: ["93"] },
  { id: "release-ax", name: "Release AX (a coach using the app as their own client can do everything a client can; Assign to Myself attaches; run AFTER Release AW)", steps: ["92"] },
  { id: "release-aw", name: "Release AW (the organization walls: names and client content readable only inside the organization; run AFTER the code that goes with it is live)", steps: ["91"] },
  { id: "release-av", name: "Release AV (a coach can still tidy up an existing row of someone who left the group; run AFTER Release AR)", steps: ["90"] },
  { id: "release-au", name: "Release AU (a coach credit pack or Lift Off grant is recorded and added in one step; run BEFORE the code that uses it deploys)", steps: ["89"] },
  { id: "release-at", name: "Release AT (private lookup functions closed to other people; run any time)", steps: ["88"] },
  { id: "release-as", name: "Release AS (coach packages can only be written by the server; run any time)", steps: ["87"] },
  { id: "release-ar", name: "Release AR (tenant safety: a coach can only file rows about people in that group; clients move only inside one organization; run any time)", steps: ["86"] },
  { id: "release-aq", name: "Release AQ (a transformation card can only use the athlete's own photos and milestone, never for a client under 18; run any time)", steps: ["85"] },
  { id: "release-an", name: "Release AN (the 'what do you call your people' card is asked once, for good; run any time)", steps: ["82"] },
  { id: "release-am", name: "Release AM (assigning an unused no-client program to one client attaches it instead of copying it; run any time)", steps: ["81"] },
  { id: "release-al", name: "Release AL (a client can switch their first name off shared workout pictures; run any time)", steps: ["80"] },
  { id: "release-ak", name: "Release AK (a one-on-one space stays a one-on-one space: its programs must be for its client, group-only features are refused there; run AFTER Release AJ)", steps: ["79"] },
  { id: "release-aj", name: "Release AJ (a client in a one-on-one space can no longer read that space's no-client programs; run AFTER Release AG)", steps: ["78"] },
  { id: "release-ag", name: "Release AG (remove a program from a client's profile without deleting it; run AFTER Release AC)", steps: ["74"] },
  { id: "release-n2", name: "Release N part 2 (run AFTER the release code is deployed: drops the old rate column)", steps: ["49", "50"] },
  { id: "release-m", name: "Release M (acceptance record is append-only)", steps: ["44"] },
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
        `    raise exception '${b.name.replace(/'/g, "''")}, step ${s.n} (${s.slug}) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;`,
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
  // programs.ai_draft (0324) is NOT NULL, and an older backup does not have it: a missing value is a signed-off program (false).
  // group_workout_exercise_sets.set_type (0385) is NOT NULL too: an older backup has none, which means an ordinary working set.
  const lines = order.map(([k, tbl]) =>
    tbl === "group_workout_exercise_sets"
      ? `  insert into public.${tbl} select * from jsonb_populate_recordset(null::public.${tbl}, (select coalesce(jsonb_agg(x || jsonb_build_object('set_type', coalesce(x ->> 'set_type', 'working'))), '[]'::jsonb) from jsonb_array_elements(b.payload -> '${k}') x));`
      : tbl === "programs"
      ? `  insert into public.programs select * from jsonb_populate_recordset(null::public.programs, (select coalesce(jsonb_agg(x || jsonb_build_object('ai_draft', coalesce((x ->> 'ai_draft')::boolean, false))), '[]'::jsonb) from jsonb_array_elements(b.payload -> 'programs') x));`
      : `  insert into public.${tbl} select * from jsonb_populate_recordset(null::public.${tbl}, b.payload -> '${k}');`
  );
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
    m("0327", has.table("coach_message_templates")),
    m("0329", "exists (select 1 from pg_constraint where conname = 'session_types_credit_cost_is_one')"),
    m("0330", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_sites' and policyname = 'coach_sites_own' and with_check like '%group_memberships%')"),
    m("0331", "to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is not null"),
    m("0338", has.col("guardian_links", "expires_at")),
    m("0367", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercise_sets' and column_name = 'target_rest_max_seconds')"),
    m("0409", "to_regclass('public.payment_events') is not null"),
    m("0398", "to_regclass('public.pending_email_changes') is not null"),
    m("0397", "exists (select 1 from pg_trigger where tgname = 'group_memberships_free_tier_limit' and not tgisinternal)"),
    m("0396", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'departing_since')"),
    m("0395", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'pushed_at')"),
    m("0394", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at')"),
    m("0393", "to_regclass('public.space_invites') is not null"),
    m("0392", "to_regprocedure('public.assign_group_coach(uuid, uuid, boolean)') is not null"),
    m("0391", "to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is not null"),
    m("0390", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id')"),
    m("0389", "to_regprocedure('public.business_last_active(uuid[])') is not null"),
    m("0388", "exists (select 1 from pg_trigger where tgname = 'client_intake_guard_completion' and tgrelid = 'public.client_intake'::regclass)"),
    m("0387", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'marketplace_listed')"),
    m("0386", "to_regprocedure('public.client_intake_guard_completion()') is not null"),
    m("0385", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'set_type')"),
    m("0384", "to_regprocedure('public.is_group_private_from_org(uuid)') is not null"),
    m("0383", "to_regclass('public.sms_suppressed_numbers') is not null"),
    m("0382", "to_regprocedure('public.training_partner_is_protected(uuid)') is not null"),
    m("0381", "to_regprocedure('public.sync_one_on_one_group_name()') is not null"),
    m("0380", "exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass)"),
    m("0379", "exists (select 1 from pg_constraint where conname = 'session_exercises_name_not_digits' and conrelid = 'public.session_exercises'::regclass) and exists (select 1 from pg_constraint where conname = 'group_workout_exercises_name_not_digits' and conrelid = 'public.group_workout_exercises'::regclass)"),
    m("0378", "pg_get_functiondef(to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)')) like '%information_schema.columns%'"),
    m("0377", "exists (select 1 from pg_constraint where conname = 'exercise_library_name_not_digits' and conrelid = 'public.exercise_library'::regclass) and exists (select 1 from pg_constraint where conname = 'exercise_aliases_target_not_digits' and conrelid = 'public.exercise_aliases'::regclass)"),
    m("0376", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_injury_flag_acknowledgements' and column_name = 'flagged_count')"),
    m("0375", "to_regclass('public.body_scans') is not null"),
    m("0374", "to_regclass('public.pr_promotions') is not null"),
    m("0373", "to_regclass('public.client_progress_pins') is not null"),
    m("0372", "to_regprocedure('public.client_exercise_rollup(uuid, uuid)') is not null"),
    m("0371", "to_regprocedure('public.flag_unclear_sets(uuid, uuid)') is not null"),
    m("0370", "to_regclass('public.attention_snoozes') is not null"),
    m("0369", "to_regclass('public.client_ai_notes') is not null"),
    m("0368", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'audience')"),
    m("0366", "position('is_slot' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) > 0"),
    m("0365", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'movement_pattern_exercises' and column_name = 'is_unilateral')"),
    m("0364", "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_sessions' and column_name = 'organization_id')"),
    m("0363", "to_regclass('public.client_sub_goals') is not null"),
    m("0362", "exists (select 1 from storage.buckets where id = 'waiver-documents' and allowed_mime_types is not null)"),
    m("0361", "to_regclass('public.exercise_catalog') is not null"),
    m("0360", "to_regprocedure('public.group_is_new_and_mine(uuid)') is not null"),
    m("0359", "position('12:00:17' in pg_get_functiondef(to_regprocedure('public.recompute_training_max()'))) > 0"),
    m("0358", "to_regprocedure('public.ensure_personal_space()') is not null"),
    m("0356", "to_regclass('public.client_quotes') is not null"),
    m("0355", "to_regclass('public.client_assessments') is not null"),
    m("0354", "to_regprocedure('public.guard_organization_share_total()') is not null"),
    m("0353", has.col("coach_booking_policies", "schedule_change_notice_days")),
    m("0352", "to_regclass('public.organization_invites') is not null"),
    m("0351", "position('p_athlete_id is null then false' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) > 0"),
    m("0350", has.col("pro_shop_links", "organization_id")),
    m("0349", "position('select true' in pg_get_functiondef(to_regprocedure('public.org_wall_header_enabled()'))) > 0"),
    m("0348", "to_regprocedure('public.request_workspace_org()') is not null"),
    m("0347", has.col("coach_briefings", "organization_id")),
    m("0346", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_phase_plans' and policyname = 'client_phase_plans_coach_manage' and position('''athlete''::member_role' in with_check) = 0)"),
    m("0345", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_visible')"),
    m("0344", "position('v_had_row' in pg_get_functiondef(to_regprocedure('public.enforce_athlete_in_group()'))) > 0"),
    m("0343", "to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is not null"),
    m("0342", "not has_function_privilege('authenticated', 'public.coach_ai_multiplier(uuid)', 'execute')"),
    m("0341", "not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach')"),
    m("0340", has.fn("enforce_athlete_in_group()")),
    m("0339", "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own')"),
    m("0337", "position('v_src_org' in pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)'))) > 0"),
    m("0336", has.col("profiles", "terminology_asked_at")),
    m("0335", "to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null"),
    m("0334", has.col("profiles", "show_name_on_share")),
    m("0333", "to_regprocedure('public.one_on_one_athlete(uuid)') is not null"),
    m("0332", "to_regprocedure('public.is_one_on_one_group(uuid)') is not null"),
    m("0328", has.col("programs", "archived_at")),
    m("0326", has.table("coach_conversations")),
    m("0325", has.col("programs", "ai_snapshot")),
    m("0324", has.col("programs", "ai_draft")),
    m("0323", has.col("group_sessions", "kind")),
    m("0322", "to_regprocedure('public.detach_profile_references(uuid)') is not null"),
    m("0321", "to_regclass('public.coach_sites') is not null"),
    m("0320", "exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'org_branding_select_owner_admin')"),
    m("0319", "exists (select 1 from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure and proconfig is not null)"),
    m("0318", "exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace and position('v_tail' in prosrc) > 0)"),
    m("0317", has.table("package_group_access")),
    m("0316", has.col("programs", "source_program_id")),
    m("0315", has.table("coach_away_replies")),
    m("0314", has.table("client_ui_settings")),
    m("0313", has.fnName("booking_counts")),
    m("0312", "coalesce((select position('coach_time_is_open' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false)"),
    m("0311", has.table("meal_plan_tries")),
    m("0310", has.col("group_workout_exercises", "display_name")),
    m("0309", "exists (select 1 from pg_proc where proname = 'notify_on_new_training_block' and pronamespace = 'public'::regnamespace)"),
    m("0308", "not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any (array[" + TRIGGER_SWEEP.map((n) => "'" + n + "'").join(", ") + "]) and has_function_privilege('authenticated', p.oid, 'execute'))"),
    m("0307","exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace and not has_function_privilege('authenticated', oid, 'execute'))"),
    m("0306", "exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace)"),
    m("0305", has.table("ai_topup_draws")),
    m("0304", has.noCol("group_memberships", "monthly_rate")),
    m("0303", has.table("client_billing_rates")),
    m("0302", has.table("custom_foods")),
    m("0301", has.table("ai_budget_notices")),
    m("0300", has.table("usda_food_portions")),
    m("0299", "exists (select 1 from pg_trigger where tgname = 'legal_acceptances_append_only' and tgrelid = 'public.legal_acceptances'::regclass)"),
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
writeFileSync(
  new URL("check-intake-flag-list.sql", outDir),
  "-- READ-ONLY. Lists the clients step 138 would require a health form and waiver of, so Ron can read the names first. Changes nothing.\nselect p.full_name, (select u.email from auth.users u where u.id = p.id) as email, (select string_agg(g.name, ', ') from public.group_memberships gm join public.groups g on g.id = gm.group_id where gm.profile_id = p.id and gm.role = 'athlete') as groups,\n  exists (select 1 from public.client_intake ci where ci.athlete_id = p.id) as has_started_form\nfrom public.profiles p\nwhere p.intake_required is not true\n  and exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'athlete')\n  and not exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'coach')\n  and not exists (select 1 from public.client_intake ci where ci.athlete_id = p.id and ci.completed_at is not null)\n  and not coalesce(p.is_platform_admin, false)\n  and not exists (select 1 from public.organization_memberships om where om.profile_id = p.id and om.role in ('owner', 'admin'))\n  and not exists (select 1 from public.group_memberships gx join public.groups gg on gg.id = gx.group_id where gx.profile_id = p.id and gg.organization_id = '50000000-0000-0000-0000-000000000001')\norder by p.full_name;\n"
);
writeFileSync(new URL("check-copy-result.sql", outDir), "-- READ-ONLY. Run after step 30 and LOOK at it before step 31: the original program and its copy, side by side. The two rows must show the same numbers.\nwith pair as (\n  select 'original (Main Group)' as which, '5b8a8a3a-344d-4192-a892-f74494fff9ab'::uuid as program_id\n  union all\n  select 'copy (The Home Team)', (select id from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program' order by created_at desc limit 1)\n)\nselect p.which,\n  (select count(*) from public.workouts w where w.program_id = p.program_id) as workouts,\n  (select count(*) from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = p.program_id) as exercises,\n  (select count(*) from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = p.program_id) as sets,\n  (select count(*) from public.workout_notes n join public.workouts w on w.id = n.workout_id where w.program_id = p.program_id) as notes,\n  (select count(*) from public.exercise_progressions q where q.program_id = p.program_id) as progressions\nfrom pair p;\n");
writeFileSync(new URL("check-step23-probe.sql", outDir), step23ProbeSql(migrationSql("0281")));
writeFileSync(new URL("steps.json", outDir), JSON.stringify(STEPS.map((s) => ({ n: s.n, slug: s.slug, migrations: s.migrations, rows: s.rows.length })), null, 1));
console.log(`wrote ${STEPS.length} steps to supabase/apply/`);
