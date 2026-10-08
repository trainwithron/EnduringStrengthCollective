-- PERMANENT CHECK (read-only, changes nothing). Run it after step 24 and after any migration that adds or changes a function.
-- WHAT YOU SHOULD SEE: every row ok = true (and no row starting UNREVIEWED). If any row is false, copy the whole result and send it to Spot.
-- Why it exists: step 13 (0271) once granted every function to signed-in users and re-opened the internal server-only ones. New functions are also
-- runnable by signed-in users by default (Supabase's per-schema default), so a new SECURITY DEFINER function with no check of who is calling is exposed
-- unless it is closed on purpose. This lists them.
select check_name, ok from (
  values
    ('no server-only function can be run by a signed-in user or the public', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['apply_session_credit_change', 'settle_booking_internal', 'promote_group_waitlist', 'offer_freed_slot_to_waitlist', 'grant_session_credits', 'rate_limit_hit', 'reserve_ai_call', 'adjust_coach_credits', 'record_sms_stop', 'record_sms_start', 'record_sms_help', 'sms_consent_for_dispatch', 'audit_record', 'audit_blocked', 'audit_blocked_redacted', 'spend_coach_credits', 'spend_ai_action', 'expire_session_credit_balance', 'refund_coach_credit_for', 'schedule_local_today', 'schedule_request_recipients', 'extend_expiry_for_freeze', 'schedule_expiry_window_days', 'shorten_expiry_after_freeze', 'settle_schedule_freeze', 'claim_schedule_request', 'claim_due_schedule_requests', 'finish_schedule_request', 'end_schedule_freeze', 'claim_due_freeze_resumes', 'fail_freeze_resume', 'note_schedule_resumed', 'ai_org_summary', 'ai_org_month_usage', 'notify_on_target_change']) and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))),
    ('the audit writers can only be run by the triggers that own them, not even by the server', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['audit_record', 'audit_blocked', 'audit_blocked_redacted']) and has_function_privilege('service_role', p.oid, 'execute'))),
    ('a signed-out visitor can run only get_invite_info (and the database event helper rls_auto_enable)', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('get_invite_info', 'rls_auto_enable') and has_function_privilege('anon', p.oid, 'execute') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))),
    ('every other signed-in-callable SECURITY DEFINER function checks who is calling, is an is_* or training_partner* helper, or was reviewed', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc !~* '(auth\.uid\(\) *(=|<>|!=)|auth\.uid\(\) is (not )?(null|distinct)|auth\.role\(\) *(=|<>)|auth\.role\(\) is|is_group_coach|is_org_admin_of_group|is_platform_admin|is_group_member|is_org_member|is_coach_of_athlete)'
    and p.proname <> all (array['coach_ai_multiplier', 'coach_client_steps', 'get_invite_info', 'has_valid_group_invite', 'athlete_in_org', 'can_view_org_branding', 'join_group_with_invite', 'set_sms_consent', 'attach_refund_reason', 'refund_coach_credit', 'group_session_counts'])
    and p.proname not like 'is\_%'
    and p.proname not like 'training\_partner%'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')))
) as checks(check_name, ok)
union all
select 'UNREVIEWED signed-in-callable function: ' || p.oid::regprocedure::text, false from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc !~* '(auth\.uid\(\) *(=|<>|!=)|auth\.uid\(\) is (not )?(null|distinct)|auth\.role\(\) *(=|<>)|auth\.role\(\) is|is_group_coach|is_org_admin_of_group|is_platform_admin|is_group_member|is_org_member|is_coach_of_athlete)'
    and p.proname <> all (array['coach_ai_multiplier', 'coach_client_steps', 'get_invite_info', 'has_valid_group_invite', 'athlete_in_org', 'can_view_org_branding', 'join_group_with_invite', 'set_sms_consent', 'attach_refund_reason', 'refund_coach_credit', 'group_session_counts'])
    and p.proname not like 'is\_%'
    and p.proname not like 'training\_partner%'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by 2, 1;
