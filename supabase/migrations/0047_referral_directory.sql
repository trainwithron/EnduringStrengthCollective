-- Allied Health Referral Directory — a coach-curated list of local
-- practitioners (massage, chiro, PT, etc.) with outbound booking links
-- and member perks. Coach-scoped for now (no organizations tier exists
-- yet), same shape as coach_availability_windows: shared across every
-- group that coach runs, visible to any of their clients.
create table public.referral_partners (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  specialty text not null,
  description text,
  booking_url text,
  discount_code text,
  discount_description text,
  click_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.referral_partners enable row level security;

create policy "referral_partners_coach_manage" on public.referral_partners for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create policy "referral_partners_client_select" on public.referral_partners for select
  to authenticated
  using (public.is_client_of_coach(coach_id));

-- Atomic click-count increment (read-then-write would race under
-- concurrent clicks, same reasoning as adjust_session_credits). Any
-- viewer who can see the row (coach or one of their clients) can record
-- a click on it.
create or replace function public.increment_referral_click(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid;
  new_count int;
begin
  select coach_id into v_coach_id from public.referral_partners where id = p_id;
  if v_coach_id is null then
    raise exception 'referral partner not found';
  end if;
  if auth.uid() <> v_coach_id and not public.is_client_of_coach(v_coach_id) then
    raise exception 'not authorized';
  end if;

  update public.referral_partners
    set click_count = click_count + 1
    where id = p_id
    returning click_count into new_count;

  return new_count;
end;
$$;
