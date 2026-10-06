-- Records the migrations Ron applied by hand in the Supabase migration history (supabase_migrations.schema_migrations), so supabase db push and
-- list_migrations show them as applied. NOT APPLIED YET: run it when you are ready. It records a migration only if its change is actually in the
-- database (each row has a check), skips ones already recorded, and does nothing for steps not applied yet, so you can run it again after later steps.
-- WHAT YOU SHOULD SEE: "Success. No rows returned." Then: select version, name from supabase_migrations.schema_migrations order by version desc limit 30;
-- ON ERROR: nothing was recorded (one transaction). Copy the red text and send it to Spot.
begin;
insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
select v.version, v.name, array['-- applied by hand through the SQL editor; the SQL is supabase/migrations/' || v.file], 'ronarnold4210@gmail.com'
from (
  values
    ('2026100600236', 'workout_session_integrity', '0236_workout_session_integrity.sql', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workout_logs_session_id_key')),
    ('2026100600237', 'join_group_with_invite', '0237_join_group_with_invite.sql', exists (select 1 from pg_proc where proname = 'join_group_with_invite' and pronamespace = 'public'::regnamespace)),
    ('2026100600238', 'close_loose_self_join_policy', '0238_close_loose_self_join_policy.sql', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check not like '%has_valid_group_invite%')),
    ('2026100600240', 'profile_guide_dismissed', '0240_profile_guide_dismissed.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'guide_dismissed_at')),
    ('2026100600241', 'program_label_and_order', '0241_program_label_and_order.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'label')),
    ('2026100600242', 'invite_revocation', '0242_invite_revocation.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_invites' and column_name = 'revoked_at')),
    ('2026100600244', 'macro_target_history_and_rls', '0244_macro_target_history_and_rls.sql', to_regclass('public.client_macro_target_history') is not null),
    ('2026100600248', 'session_credit_settlement', '0248_session_credit_settlement.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('2026100600249', 'coach_completion_message', '0249_coach_completion_message.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_profiles' and column_name = 'completion_message')),
    ('2026100600250', 'ai_allowance_beta_scale', '0250_ai_allowance_beta_scale.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_billing' and column_name = 'ai_allowance_scale')),
    ('2026100600251', 'kiosk_pins_hashed', '0251_kiosk_pins_hashed.sql', to_regclass('public.kiosk_pins') is not null),
    ('2026100600252', 'drop_plaintext_kiosk_pin', '0252_drop_plaintext_kiosk_pin.sql', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'kiosk_pin')),
    ('2026100600253', 'close_anon_share_policies', '0253_close_anon_share_policies.sql', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_select_public_workout_share')),
    ('2026100600254', 'client_tag_write_rules', '0254_client_tag_write_rules.sql', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_tags' and policyname = 'client_tags_insert_owner_admin')),
    ('2026100600255', 'legal_acceptances', '0255_legal_acceptances.sql', to_regclass('public.legal_acceptances') is not null),
    ('2026100600256', 'marketplace_listing_opt_in', '0256_marketplace_listing_opt_in.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'listed_in_marketplace')),
    ('2026100600257', 'feedback_reports', '0257_feedback_reports.sql', to_regclass('public.feedback_reports') is not null),
    ('2026100600258', 'nav_query_log', '0258_nav_query_log.sql', to_regclass('public.nav_query_log') is not null),
    ('2026100600259', 'booking_series_ongoing', '0259_booking_series_ongoing.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'mode')),
    ('2026100600260', 'reup_and_payment_holds', '0260_reup_and_payment_holds.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'payment_hold')),
    ('2026100600261', 'public_booking_page', '0261_public_booking_page.sql', to_regclass('public.coach_booking_pages') is not null),
    ('2026100600262', 'cron_runs', '0262_cron_runs.sql', to_regclass('public.cron_runs') is not null),
    ('2026100600263', 'group_sessions', '0263_group_sessions.sql', to_regclass('public.group_sessions') is not null),
    ('2026100600264', 'session_credits_coach_only_update', '0264_session_credits_coach_only_update.sql', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'session_credits' and policyname = 'credits_update_coach')),
    ('2026100600265', 'bookings_coach_only_direct_writes', '0265_bookings_coach_only_direct_writes.sql', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bookings' and policyname = 'bookings_update_coach')),
    ('2026100600266', 'client_write_column_guards', '0266_client_write_column_guards.sql', exists (select 1 from pg_trigger where tgname = 'profiles_guard_sensitive_columns')),
    ('2026100600267', 'audit_trail', '0267_audit_trail.sql', to_regclass('public.audit_log') is not null),
    ('2026100600268', 'guard_fixes_and_audit_redaction', '0268_guard_fixes_and_audit_redaction.sql', exists (select 1 from pg_proc where proname = 'guard_athlete_session_insert' and pronamespace = 'public'::regnamespace)),
    ('2026100600269', 'group_session_fixes', '0269_group_session_fixes.sql', exists (select 1 from pg_proc where proname = 'guard_group_session_bookings' and pronamespace = 'public'::regnamespace)),
    ('2026100600270', 'membership_insert_needs_a_real_client', '0270_membership_insert_needs_a_real_client.sql', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'group_memberships' and policyname = 'memberships_insert_coach_or_self' and with_check like '%is_coach_of_athlete%')),
    ('2026100600271', 'function_permissions_signed_in_only', '0271_function_permissions_signed_in_only.sql', not has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')),
    ('2026100600272', 'public_forms_only_through_the_server', '0272_public_forms_only_through_the_server.sql', not has_function_privilege('anon', 'public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text)', 'execute')),
    ('2026100600273', 'group_and_organization_column_guards', '0273_group_and_organization_column_guards.sql', exists (select 1 from pg_trigger where tgname = 'groups_guard_columns')),
    ('2026100600274', 'completed_workout_lock', '0274_completed_workout_lock.sql', coalesce((select position('tg_op' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'block_athlete_edits_to_completed_session' and p.pronamespace = 'public'::regnamespace), false)),
    ('2026100600275', 'series_session_removed_stays_removed', '0275_series_session_removed_stays_removed.sql', exists (select 1 from pg_trigger where tgname = 'bookings_note_series_skip')),
    ('2026100600276', 'notify_on_direct_message', '0276_notify_on_direct_message.sql', exists (select 1 from pg_trigger where tgname = 'direct_messages_notify')),
    ('2026100600277', 'late_change_flagged_for_coach', '0277_late_change_flagged_for_coach.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'late_charge_state')),
    ('2026100600278', 'booking_mode', '0278_booking_mode.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'booking_mode')),
    ('2026100600279', 'booking_requests', '0279_booking_requests.sql', to_regclass('public.booking_requests') is not null),
    ('2026100600280', 'credit_expiry_human_overrides', '0280_credit_expiry_human_overrides.sql', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'expiry_hold_until')),
    ('2026100600281', 'inactive_clients', '0281_inactive_clients.sql', to_regclass('public.client_inactive') is not null)
) as v(version, name, file, applied)
where v.applied
on conflict (version) do nothing;
commit;
