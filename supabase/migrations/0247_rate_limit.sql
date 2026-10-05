-- A small shared rate limiter for public and abuse-prone routes (coach signup, trainer-dispatch submit and reply,
-- client invites, claim links). Fixed windows, one counter row per (key, window). Called only by the server with the
-- service role; code that calls it lets the request through if this function is missing, so applying this
-- migration is optional for safety of the deploy and simply turns the limits on.

create table if not exists public.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limit_hits enable row level security;
-- No policies: only the service role (which bypasses row-level security) touches this table.

create or replace function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  if p_key is null or length(p_key) = 0 or p_max < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_hits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;

  -- Housekeeping: now and then drop windows that are long over.
  if random() < 0.01 then
    delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  end if;

  return v_hits <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, int, int) from public;
revoke all on function public.rate_limit_hit(text, int, int) from anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
