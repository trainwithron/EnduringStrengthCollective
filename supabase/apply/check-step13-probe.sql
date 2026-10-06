-- RUN ONCE BEFORE STEP 13 (baseline: anon_can_run = true) AND AGAIN AFTER STEP 13 (must show anon_can_run = false). Read-only in effect: it makes a throwaway function, asks who can run it, and rolls everything back, so no test project is needed.
-- WHAT YOU SHOULD SEE: one row with anon_can_run = false, signed_in_can_run = true, server_can_run = true. If anon_can_run is true, tell Spot.
begin;
create function public.zz_probe() returns int language sql as 'select 1';
select has_function_privilege('anon', 'public.zz_probe()', 'execute') as anon_can_run,
       has_function_privilege('authenticated', 'public.zz_probe()', 'execute') as signed_in_can_run,
       has_function_privilege('service_role', 'public.zz_probe()', 'execute') as server_can_run;
rollback;

-- And the list of functions a signed-out visitor can still run. Before step 17: get_invite_info, book_discovery_call, submit_gym_visitor_lead. After step 17: only get_invite_info.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1;

-- NOTE for later: step 13 also removes the public-execute default for functions the editor role creates. After any future CREATE EXTENSION run in the SQL editor, grant execute on its functions to authenticated and service_role (or enable it from the Supabase dashboard).