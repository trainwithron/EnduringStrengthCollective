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
export const SERVER_ONLY = SERVER_ONLY_SIGNATURES.map((s) => s[0]);
export const AUDIT_WRITERS = SERVER_ONLY_SIGNATURES.filter((s) => s[2]).map((s) => s[0]);

// Signed-in-callable SECURITY DEFINER functions with no caller check in their body that were reviewed and are meant to be (they answer about the
// caller's own context, are RLS helpers, or are public by design). Anything else new that is signed-in-callable and has no caller check fails
// check-function-acl.sql. (is_* and training_partner* helpers are matched by prefix.)
export const ACL_REVIEWED = [
  "coach_ai_multiplier", "coach_client_steps", "get_invite_info", "has_valid_group_invite", "athlete_in_org", "can_view_org_branding",
  "join_group_with_invite", "set_sms_consent", "attach_refund_reason", "refund_coach_credit", "spend_ai_action", "group_session_counts",
];

const quote = (names) => names.map((n) => `'${n}'`).join(", ");

// Undo for step 24: back to what step 13 left (signed-in and server).
export const undoSql = () =>
  SERVER_ONLY_SIGNATURES.map(([n, a]) => `grant execute on function public.${n}(${a}) to authenticated, service_role;`).join("\n");

// The body checks that count as "this function looks at who is calling".
const CALLER_CHECK =
  "(auth\\.uid\\(\\)|auth\\.role\\(\\)|is_group_coach|is_org_admin_of_group|is_platform_admin|is_group_member|is_org_member|is_coach_of_athlete|request\\.jwt)";

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
    `    ('every other signed-in-callable SECURITY DEFINER function checks who is calling, is an is_* or training_partner* helper, or was reviewed', not exists (select 1 from pg_proc p where ${offenderWhere}))`,
    ") as checks(check_name, ok)",
    "union all",
    `select 'UNREVIEWED signed-in-callable function: ' || p.oid::regprocedure::text, false from pg_proc p where ${offenderWhere}`,
    "order by 2, 1;",
    "",
  ].join("\n");
