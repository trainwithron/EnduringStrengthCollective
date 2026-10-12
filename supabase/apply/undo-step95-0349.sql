-- UNDO for step 95 (0349). The off switch: puts the rule back to switched off without removing it. Safe at any time.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as 'select false';
commit;
