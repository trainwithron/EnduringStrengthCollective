// Which public functions a signed-in person may and may not run (0282 and check-function-acl.sql). Kept in one place so the migration, the undo, the
// permanent check and the paste test all use the same list.

// Functions with no check of who is calling inside them: only the server (service role) or other functions may call them, never a signed-in person.
// [name, argument types, audit writer (closed to the server too)]
export const SERVER_ONLY_SIGNATURES = [
  ["apply_session_credit_change", "uuid, uuid, integer, text, text, uuid, uuid", false],
  ["settle_booking_internal", "uuid, integer, text, uuid, uuid, uuid", false],
  ["promote_group_waitlist", "uuid", false],
  ["offer_freed_slot_to_waitlist", "uuid, timestamptz, timestamptz", false],
  ["grant_session_credits", "uuid, uuid, integer, text, text", false],
  ["rate_limit_hit", "text, integer, integer", false],
  ["reserve_ai_call", "uuid, uuid, text, boolean, integer, text[], integer", false],
  ["adjust_coach_credits", "uuid, integer", false],
  ["record_sms_stop", "text", false],
  ["record_sms_start", "text", false],
  ["record_sms_help", "text", false],
  ["sms_consent_for_dispatch", "uuid, text", false],
  ["audit_record", "text, text, text, jsonb", true],
  ["audit_blocked", "text, text, jsonb, jsonb, text[]", true],
  ["audit_blocked_redacted", "text, text, jsonb, jsonb, text[], text[]", true],
];
// Closed by 0290 (Release F): spend_coach_credits trusted a negative cost and spend_ai_action trusted the allowance and cost sent by the browser, so only the
// server (which passes its own numbers after checking who is signed in) may run them. Kept apart from the 0282 list because 0282 predates this.
export const RELEASE_F_SERVER_ONLY_SIGNATURES = [
  ["spend_coach_credits", "uuid, integer", false],
  ["spend_ai_action", "uuid, text, integer, integer", false],
  ["expire_session_credit_balance", "uuid, uuid, integer, integer", false],
];
// Closed by 0293: the refund logic (either trigger, for a named coach) is server-only; the signed-in refund_coach_credit now accepts only the coach's own "this was wrong".
export const RELEASE_H_SERVER_ONLY_SIGNATURES = [["refund_coach_credit_for", "uuid, text, text, text, text, uuid", false]];
// Closed by 0297: the functions the server uses to apply a schedule request and to restart a freeze (a signed-in person can only ask, withdraw or mark handled).
export const RELEASE_L_SERVER_ONLY_SIGNATURES = [
  ["schedule_local_today", "text, uuid", false],
  ["schedule_request_recipients", "uuid, uuid", false],
  ["extend_expiry_for_freeze", "uuid, uuid, uuid, integer, text", false],
  ["schedule_expiry_window_days", "uuid, uuid", false],
  ["shorten_expiry_after_freeze", "uuid, uuid, uuid, integer, text", false],
  ["settle_schedule_freeze", "uuid, uuid, uuid, date, date, integer", false],
  ["claim_schedule_request", "uuid, boolean", false],
  ["claim_due_schedule_requests", "integer", false],
  ["finish_schedule_request", "uuid, boolean, boolean, boolean, text", false],
  ["end_schedule_freeze", "uuid, date", false],
  ["claim_due_freeze_resumes", "integer", false],
  ["fail_freeze_resume", "uuid, text", false],
  ["note_schedule_resumed", "uuid, integer, integer", false],
];
// Added by 0301: the month's AI cost per coach, read by the server to enforce the AI budget.
export const RELEASE_N_SERVER_ONLY_SIGNATURES = [
  ["ai_org_summary", "uuid", false],
  ["ai_org_month_usage", "uuid, timestamptz", false],
];
// Closed by 0306 / 0307: the target-change notice trigger function (a trigger function nobody can call as a function, but internal functions are closed on purpose).
export const RELEASE_O_SERVER_ONLY_SIGNATURES = [["notify_on_target_change", "", false]];
// Closed from the start by 0311: applying a client's meal plan try is done by the server only (the count and the hand-built-day rule are enforced inside it).
export const RELEASE_R_SERVER_ONLY_SIGNATURES = [["apply_meal_plan_try", "uuid, uuid, date, jsonb, text, text", false]];
// Closed by 0308 (Release O fix, step 53): every trigger function a signed-in person could run by default. A trigger function can only ever run as a trigger (nobody can call it
// as a function or through the API), and the right to run it is checked when the trigger is created, not when it fires, so closing them changes nothing that works; it makes them
// follow the same rule as every other internal function. Their ACL before was exactly: owner, authenticated, service_role (no anon, no PUBLIC). notify_on_target_change is not here:
// step 52 (0307) closed it. A trigger function that app code calls through .rpc() must NOT be on this list (none are: a trigger function cannot be called that way).
export const TRIGGER_SWEEP = [
  "audit_log_refuse_changes", "audit_watch", "backfill_placeholder_group_name", "block_athlete_edits_to_completed_session", "clear_client_goal_phase_on_insert",
  "default_client_tier_for_one_on_one", "enforce_one_on_one_athlete_limit", "guard_ai_recipe_ingredient", "guard_athlete_session_columns", "guard_athlete_session_insert",
  "guard_client_goal_update", "guard_client_nutrition_feedback", "guard_client_nutrition_preferences", "guard_direct_message_columns", "guard_group_columns",
  "guard_group_session_bookings", "guard_membership_identity", "guard_organization_columns", "guard_partner_request_columns", "guard_post_columns",
  "guard_profile_sensitive_columns", "guard_workout_log_columns", "limit_food_favorites", "note_series_session_skipped", "notify_on_client_goal", "notify_on_comment",
  "notify_on_direct_message", "notify_on_gym_visitor_lead", "notify_on_macros_assigned", "notify_on_mention", "notify_on_nutrition_baseline", "notify_on_nutrition_feedback",
  "notify_on_nutrition_preferences", "notify_on_partner_request", "notify_on_post_mention", "notify_on_program_assigned", "notify_on_video_comment", "notify_on_video_upload",
  "phase_follows_confirmed_goal", "prevent_platform_admin_self_escalation", "recompute_training_max", "recompute_workout_log", "resurface_inactive_client",
  "set_gwe_athlete_id", "set_workout_athlete_id", "set_workout_notes_athlete_id",
];

// Undo for step 53: back to exactly what each had (owner, signed-in users and the server).
export const triggerSweepUndoSql = () =>
  TRIGGER_SWEEP.map((n) => `do $u$ begin if to_regprocedure('public.${n}()') is not null then grant execute on function public.${n}() to authenticated; end if; end $u$;`).join(String.fromCharCode(10));

export const SERVER_ONLY = [...SERVER_ONLY_SIGNATURES, ...RELEASE_F_SERVER_ONLY_SIGNATURES, ...RELEASE_H_SERVER_ONLY_SIGNATURES, ...RELEASE_L_SERVER_ONLY_SIGNATURES, ...RELEASE_N_SERVER_ONLY_SIGNATURES, ...RELEASE_O_SERVER_ONLY_SIGNATURES, ...RELEASE_R_SERVER_ONLY_SIGNATURES].map((s) => s[0]);
export const AUDIT_WRITERS = SERVER_ONLY_SIGNATURES.filter((s) => s[2]).map((s) => s[0]);

// Signed-in-callable SECURITY DEFINER functions with no caller check in their body that were reviewed and are meant to be (they answer about the
// caller's own context, are RLS helpers, or are public by design). Anything else new that is signed-in-callable and has no caller check fails
// check-function-acl.sql. (is_* and training_partner* helpers are matched by prefix.)
export const ACL_REVIEWED = [
  "coach_ai_multiplier", "coach_client_steps", "get_invite_info", "has_valid_group_invite", "athlete_in_org", "can_view_org_branding",
  "join_group_with_invite", "set_sms_consent", "attach_refund_reason", "refund_coach_credit", "group_session_counts",
];

const quote = (names) => names.map((n) => `'${n}'`).join(", ");

// Undo for step 24: back to what step 13 left (signed-in and server).
export const undoSql = () =>
  SERVER_ONLY_SIGNATURES.map(([n, a]) => `grant execute on function public.${n}(${a}) to authenticated, service_role;`).join("\n");

// The body checks that count as "this function looks at who is calling".
const CALLER_CHECK =
  "(auth\\.uid\\(\\) *(=|<>|!=)|auth\\.uid\\(\\) is (not )?(null|distinct)|auth\\.role\\(\\) *(=|<>)|auth\\.role\\(\\) is|is_group_coach|is_org_admin_of_group|is_platform_admin|is_group_member|is_org_member|is_coach_of_athlete)";

const offenderWhere = [
  "p.pronamespace = 'public'::regnamespace",
  "p.prokind = 'f'",
  "p.prosecdef",
  "p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)",
  "has_function_privilege('authenticated', p.oid, 'execute')",
  `p.prosrc !~* '${CALLER_CHECK}'`,
  `p.proname <> all (array[${quote(ACL_REVIEWED)}])`,
  "p.proname not like 'is\\_%'",
  "p.proname not like 'training\\_partner%'",
  "not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')",
].join("\n    and ");

export const checkSql = () =>
  [
    "-- PERMANENT CHECK (read-only, changes nothing). Run it after step 24 and after any migration that adds or changes a function.",
    "-- WHAT YOU SHOULD SEE: every row ok = true (and no row starting UNREVIEWED). If any row is false, copy the whole result and send it to Spot.",
    "-- Why it exists: step 13 (0271) once granted every function to signed-in users and re-opened the internal server-only ones. New functions are also",
    "-- runnable by signed-in users by default (Supabase's per-schema default), so a new SECURITY DEFINER function with no check of who is calling is exposed",
    "-- unless it is closed on purpose. This lists them.",
    "select check_name, ok from (",
    "  values",
    `    ('no server-only function can be run by a signed-in user or the public', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${quote(SERVER_ONLY)}]) and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))),`,
    `    ('the audit writers can only be run by the triggers that own them, not even by the server', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${quote(AUDIT_WRITERS)}]) and has_function_privilege('service_role', p.oid, 'execute'))),`,
    `    ('a signed-out visitor can run only get_invite_info (and the database event helper rls_auto_enable)', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('get_invite_info', 'rls_auto_enable') and has_function_privilege('anon', p.oid, 'execute') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))),`,
    `    ('every other signed-in-callable SECURITY DEFINER function checks who is calling, is an is_* or training_partner* helper, or was reviewed', not exists (select 1 from pg_proc p where ${offenderWhere})),`,
    "    ('no trigger function can be run by a signed-in user or the public (they only ever run as triggers, so they are closed like the other internal functions)', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')))",
    ") as checks(check_name, ok)",
    "union all",
    `select 'UNREVIEWED signed-in-callable function: ' || p.oid::regprocedure::text, false from pg_proc p where ${offenderWhere}`,
    "order by 2, 1;",
    "",
  ].join("\n");
