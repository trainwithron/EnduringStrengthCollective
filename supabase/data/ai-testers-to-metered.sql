-- DATA STEP (prepared, NOT run, not part of any release paste): turn the internal unlimited tester coaches into ordinary metered coaches with the FULL standard AI budget.
-- Runs only on Ron's typed word. Safe to read and to dry-run the PRECHECK section at any time (it changes nothing).
--
-- What it does, for every coach whose coach_credits.ai_access_mode is 'unlimited' today:
--   1. remembers who they were (table _ai_tester_conversion, so the undo is exact),
--   2. sets ai_access_mode = 'metered' (their AI is then counted against their organization's pooled monthly budget like anyone else's),
--   3. sets the scale of every organization they own to 1 (organization_billing.ai_allowance_scale), so a free-access (beta) tester organization gets the FULL standard budget
--      ($25 per 100-client step) instead of the reduced beta share. Only organizations whose scale is not already set are changed, and each one is remembered for the undo.
-- It does not touch balances, billing flags, or anything else. Re-running it is harmless (already-metered coaches are skipped).

-- ===== PRECHECK (read-only): who would change =====
select cc.coach_id, p.full_name, o.id as owned_organization_id, o.name as organization_name,
       ob.ai_allowance_scale as current_scale, coalesce(ob.billing_exempt, false) as free_access
from public.coach_credits cc
join public.profiles p on p.id = cc.coach_id
left join public.organizations o on o.owner_id = cc.coach_id
left join public.organization_billing ob on ob.organization_id = o.id
where cc.ai_access_mode = 'unlimited'
order by p.full_name;

-- ===== APPLY =====
begin;

create table if not exists public._ai_tester_conversion (
  kind text not null check (kind in ('coach', 'org_scale')),
  coach_id uuid,
  organization_id uuid,
  previous_scale numeric,
  had_billing_row boolean,
  converted_at timestamptz not null default now()
);

insert into public._ai_tester_conversion (kind, coach_id)
select 'coach', cc.coach_id from public.coach_credits cc where cc.ai_access_mode = 'unlimited';

insert into public._ai_tester_conversion (kind, organization_id, previous_scale, had_billing_row)
select 'org_scale', o.id, ob.ai_allowance_scale, ob.organization_id is not null
from public.organizations o
join public.coach_credits cc on cc.coach_id = o.owner_id and cc.ai_access_mode = 'unlimited'
left join public.organization_billing ob on ob.organization_id = o.id
where ob.ai_allowance_scale is null;

insert into public.organization_billing (organization_id, ai_allowance_scale, updated_at)
select c.organization_id, 1, now() from public._ai_tester_conversion c where c.kind = 'org_scale'
on conflict (organization_id) do update set ai_allowance_scale = 1, updated_at = now()
where public.organization_billing.ai_allowance_scale is null;

update public.coach_credits set ai_access_mode = 'metered'
where coach_id in (select coach_id from public._ai_tester_conversion where kind = 'coach');

-- Show the result before committing.
select cc.coach_id, cc.ai_access_mode, ob.ai_allowance_scale
from public.coach_credits cc
left join public.organizations o on o.owner_id = cc.coach_id
left join public.organization_billing ob on ob.organization_id = o.id
where cc.coach_id in (select coach_id from public._ai_tester_conversion where kind = 'coach');
commit;

-- ===== UNDO (exact; run only if the conversion should be reversed) =====
-- begin;
-- update public.coach_credits set ai_access_mode = 'unlimited'
--   where coach_id in (select coach_id from public._ai_tester_conversion where kind = 'coach');
-- update public.organization_billing ob set ai_allowance_scale = c.previous_scale, updated_at = now()
--   from public._ai_tester_conversion c where c.kind = 'org_scale' and c.had_billing_row and ob.organization_id = c.organization_id;
-- delete from public.organization_billing ob using public._ai_tester_conversion c
--   where c.kind = 'org_scale' and not c.had_billing_row and ob.organization_id = c.organization_id
--     and not ob.billing_exempt and ob.exempt_reason is null;
-- drop table public._ai_tester_conversion;
-- commit;
