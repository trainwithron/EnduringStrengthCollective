-- UNDO for step 178 (0426). Only if step 178 misbehaves. Puts every org_wall_header policy back on group_in_active_org(group_id) and drops the new function (the wall is then asked once per row again).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $$
declare r record;
begin
  for r in select tablename from pg_policies where schemaname = 'public' and policyname = 'org_wall_header' and qual like '%active_org_group_ids()%' loop
    execute format('alter policy org_wall_header on public.%I using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id))', r.tablename);
  end loop;
end $$;
drop function if exists public.active_org_group_ids();
commit;
