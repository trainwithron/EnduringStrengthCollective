-- "Assign sessions": a coach gives a client a number of sessions with an optional note (for example "12 sessions,
-- paid in person"), with no purchase involved. The client's balance, the calendar and in-app booking then work
-- exactly as they do for a purchased package, because the balance is the same session_credits row.
--
-- Every assignment is recorded in session_credit_adjustments so there is a trail of who added what and why.
-- Only adds; removing sessions stays with the existing minus control. Nothing is deducted automatically.

create table if not exists public.session_credit_adjustments (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  delta int not null check (delta > 0),
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists session_credit_adjustments_athlete_idx
  on public.session_credit_adjustments (athlete_id, group_id, created_at desc);

alter table public.session_credit_adjustments enable row level security;
-- Coaches of the group and the client themselves can read it; rows are written only by the function below.
create policy "session_credit_adjustments_select" on public.session_credit_adjustments for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

create or replace function public.assign_session_credits(
  p_athlete_id uuid,
  p_group_id uuid,
  p_amount int,
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to assign sessions';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'sessions to assign must be between 1 and 500';
  end if;
  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete'
  ) then
    raise exception 'that person is not a client in this group';
  end if;

  insert into public.session_credits (athlete_id, group_id, balance)
  values (p_athlete_id, p_group_id, p_amount)
  on conflict (athlete_id, group_id)
  do update set balance = public.session_credits.balance + p_amount, updated_at = now()
  returning balance into v_balance;

  insert into public.session_credit_adjustments (athlete_id, group_id, delta, note, created_by)
  values (p_athlete_id, p_group_id, p_amount, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  return v_balance;
end;
$$;

grant execute on function public.assign_session_credits(uuid, uuid, int, text) to authenticated;
