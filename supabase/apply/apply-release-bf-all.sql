-- RELEASE BF (THE MONEY SETTINGS ON ORGANIZATION MEMBERSHIPS ARE THE SERVER'S; SHARES NEVER TOTAL OVER 100 PERCENT; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 100 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 100: A coach still connects their own Stripe account through the Connect screen, and an organization owner still sets each member's role and revenue share; nobody signed in can change a member's connected account any more. A share that would take the total over 100% is refused with 'These shares add up to more than 100%. Lower one to save.' A new organization's owner starts with the whole share (100%). Nothing existing changes.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BF (the money settings on organization memberships are the server's; shares never total over 100 percent; run BEFORE the code that goes with it is live), step 100: 0354 The money settings on an organization membership are the server's: the connected Stripe account can no longer be written by an owner or anyone signed in, and the shares in an organization can never add up to more than 100 percent
do $g100$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0354 is not already applied (the share-total rule does not exist yet)', to_regprocedure('public.guard_organization_share_total()') is null),
      ('the memberships table has the money columns', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'stripe_connect_account_id') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'revenue_share_pct'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BF (the money settings on organization memberships are the server''s; shares never total over 100 percent; run BEFORE the code that goes with it is live), step 100 (0354) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g100$;

-- ====================================================================================================
-- migration 0354_organization_money_columns_server_only.sql
-- ====================================================================================================

-- Release BF: walling off the money settings on organization memberships.
-- 1. The Stripe columns on a membership (the connected account id and its status) can be written ONLY by the server. Until now an organization's owner could put their own connected account on a coach's
--    membership and so redirect that coach's revenue-share transfers to themselves. A coach connects only their own account, through the Connect onboarding route (service role). The owner can still change
--    a member's role and revenue share, and nothing else on the row.
-- 2. The shares in one organization can never add up to more than 100%. The database refuses it, in plain words.
-- 3. A new organization's owner starts with the whole share (100%) instead of 0%, so the owner is not paid nothing by default.
revoke insert, update on public.organization_memberships from authenticated, anon;
grant update (role, revenue_share_pct) on public.organization_memberships to authenticated;

create or replace function public.guard_organization_share_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_others numeric;
begin
  -- A new owner with nothing yet set, in an organization where nobody has a share, starts with the whole share.
  if tg_op = 'INSERT' and new.role = 'owner' and coalesce(new.revenue_share_pct, 0) = 0
     and not exists (select 1 from public.organization_memberships m where m.organization_id = new.organization_id and m.revenue_share_pct > 0) then
    new.revenue_share_pct := 100;
  end if;
  if tg_op = 'UPDATE' and new.revenue_share_pct is not distinct from old.revenue_share_pct then
    return new;
  end if;
  select coalesce(sum(m.revenue_share_pct), 0) into v_others
  from public.organization_memberships m
  where m.organization_id = new.organization_id and m.id is distinct from new.id;
  if v_others + coalesce(new.revenue_share_pct, 0) > 100 then
    raise exception using message = 'These shares add up to more than 100%. Lower one to save.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_organization_share_total() from public, anon, authenticated;

drop trigger if exists organization_memberships_share_total on public.organization_memberships;
create trigger organization_memberships_share_total
  before insert or update of revenue_share_pct on public.organization_memberships
  for each row execute function public.guard_organization_share_total();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 100 (0354)' as step, '0354 The money settings on an organization membership are the server''s: the connected Stripe account can no longer be written by an owner or anyone signed in' as what, not ((to_regprocedure('public.guard_organization_share_total()') is null)) as in_place
) as result order by step;
