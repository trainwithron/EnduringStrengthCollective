-- Session-credit balance changes were a read-then-write race: the client
-- read the current balance, computed balance ± 1, then wrote that back —
-- two tabs booking two different slots off the same starting balance of 1
-- could both succeed, since neither write depended on the other's result.
-- This makes the adjustment a single atomic UPDATE instead.
--
-- security definer so an athlete (who only has UPDATE/no INSERT on their
-- own session_credits row) can still hit the upsert path the first time a
-- credit is spent — the authorization check below stands in for RLS since
-- security definer bypasses it.
create or replace function public.adjust_session_credits(
  p_athlete_id uuid,
  p_group_id uuid,
  p_delta int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to adjust these session credits';
  end if;

  insert into public.session_credits (athlete_id, group_id, balance)
  values (p_athlete_id, p_group_id, greatest(0, p_delta))
  on conflict (athlete_id, group_id)
  do update set
    balance = greatest(0, public.session_credits.balance + p_delta),
    updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;

grant execute on function public.adjust_session_credits(uuid, uuid, int) to authenticated;
