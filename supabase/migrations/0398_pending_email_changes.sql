-- 0398: a coach changing the sign-in email of a client who has already signed in no longer changes it on the spot. The new address is asked to confirm by an emailed link first (and the old address is told), and
-- only then does it become the login. This table holds the waiting requests: the link carries a random token, only its hash is stored, a request lasts 48 hours, and a newer request for the same person
-- replaces an older one. Nobody reads or writes it from the app: only the server (service key) touches it.

create table if not exists public.pending_email_changes (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  new_email text not null,
  old_email text,
  token_hash text not null unique,
  requested_by uuid references public.profiles(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pending_email_changes_profile_idx on public.pending_email_changes (profile_id, created_at desc);
alter table public.pending_email_changes enable row level security;
revoke all on public.pending_email_changes from anon, authenticated;

-- Two new kinds of notice to the client: a change was asked for (nothing has changed yet), and it was cancelled.
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['email_change_requested', 'email_change_cancelled']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;
