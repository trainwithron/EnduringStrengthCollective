// Builds the numbered paste-ready SQL files under supabase/apply/ from the migration files: for each step a read-only PRECHECK file (every row
// must say ok = true) and the APPLY file (begin ... commit, so it is all or nothing). Nothing in them searches existing text.
//   node scripts/build-paste-files.mjs
// scripts/sql-tests/paste-files.test.mjs applies every step in order on the live-equivalent schema and checks each precheck is true first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../supabase/", import.meta.url);
const outDir = new URL("apply/", root);
mkdirSync(outDir, { recursive: true });

import { readdirSync } from "node:fs";
const index = {};
for (const f of readdirSync(new URL("migrations/", root))) if (/^\d{4}_/.test(f)) index[f.slice(0, 4)] = f;
const migrationSql = (n) => readFileSync(new URL(`migrations/${index[n]}`, root), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "");

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
  const body = s.migrations.map((n) => `${bar}\n-- migration ${index[n]}\n${bar}\n\n${migrationSql(n)}\n`).join("\n");
  writeFileSync(new URL(`${base}.sql`, outDir), `${header(s, "apply")}\n\nbegin;\n\n${guardFor(s)}${body}\ncommit;\n`);
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

writeFileSync(new URL("steps.json", outDir), JSON.stringify(STEPS.map((s) => ({ n: s.n, slug: s.slug, migrations: s.migrations, rows: s.rows.length })), null, 1));
console.log(`wrote ${STEPS.length} steps to supabase/apply/`);
