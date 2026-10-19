-- Release TC3 part B: "Request to train with me" on a coach's public page (/c/<slug>). A visitor makes an account or signs in and sends a request; it waits for the coach with Approve and Decline. NOTHING is granted by
-- sending a request: no seat, no data, no access. Approving puts the person in as an ordinary client with their own one-on-one space in the coach's organization, and the existing rules for age, guardian consent and
-- intake then apply to them exactly as for any new client. There is no link, no signature and no message: the public page already says whose it is, and the request is only "who".
--
--   coach_booking_pages.accepts_requests   one switch in the coach's Booking page settings, ON by default; the button on the public page is shown only when the page is on and this is on.
--   client_requests          who asked, of which coach and organization, the date of birth in force (the YOUNGER of the one on file and the one typed: kept to refuse under 13 and to tell the coach "under 18"), and the answer
--                            (waiting, approved, declined, or expired when the coach could no longer take them). Only the person who asked can read their own row; the coach reads waiting requests ONLY through coach_client_requests().
--   client_request_attempts  every try, answered or refused, for the hourly limit (kept two days; a daily job clears it for everyone).
--   client_request_blocks    an account that gave a date of birth under 13 is refused for 30 days, whatever date it types next.
--   Functions (signed-in only; nothing else writes these tables):
--     submit_client_request     answers {ok, id} or {ok:false, code, message}. Refuses a page that is off, a coach asking themselves, under 13, someone who already trains with this coach, a request declined in the last 30 days,
--                               a coach with 50 requests already waiting or 60 new ones in the last hour, and more than 5 tries an hour from one account. Serialized per account and per coach (advisory locks).
--     coach_client_requests     the coach's list for ONE organization: every waiting request as First L. with NO photo under the request's own id (the full name and photo come after Approve, when they are the coach's client).
--     coach_client_request_count    how many are waiting in that organization (for the badge)
--     approve_client_request / decline_client_request / decline_all_client_requests    the coach's answers; the person is told in plain words what happens next (a decline says only that the coach is not taking new clients now)
-- Approving also carries the younger date of birth to the person's records (the profile's birthday when it has none or an older one; client_intake when it has no date); a date already in client_intake is never overwritten:
-- if it puts the person in an OLDER age group than the date given with the request, the approval is refused (the request stays waiting) until support has corrected it.
-- Adds one column, two notice kinds, three tables and eight functions. Re-runnable.

-- the new notice kinds (same widening as 0393: read the live list, add, check it matches)
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['client_request', 'client_request_answer']) as t;
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

alter table public.coach_booking_pages add column if not exists accepts_requests boolean not null default true;

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_dob date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  result_group_id uuid references public.groups(id) on delete set null
);
-- one waiting request per person for the same coach and organization
create unique index if not exists client_requests_one_pending on public.client_requests (coach_id, organization_id, requester_id) where status = 'pending';
create index if not exists client_requests_coach_idx on public.client_requests (coach_id, status, created_at desc);
create index if not exists client_requests_requester_idx on public.client_requests (requester_id, created_at desc);

create table if not exists public.client_request_attempts (
  id bigserial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  outcome text not null default 'tried'
);
create index if not exists client_request_attempts_profile_idx on public.client_request_attempts (profile_id, at desc);

create table if not exists public.client_request_blocks (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.client_requests enable row level security;
alter table public.client_request_attempts enable row level security;
alter table public.client_request_blocks enable row level security;
revoke all on public.client_requests from anon, authenticated;
revoke all on public.client_request_attempts from anon, authenticated;
revoke all on public.client_request_blocks from anon, authenticated;
grant select on public.client_requests to authenticated;
-- only the person who asked reads their own row; the coach reads waiting requests through coach_client_requests() so a date of birth or a full name a minor typed never reaches them
drop policy if exists client_requests_select on public.client_requests;
create policy client_requests_select on public.client_requests for select to authenticated using (requester_id = (select auth.uid()));

-- First name and the first letter of the last name ("Sam R."); one word stays as it is.
create or replace function public.client_request_short_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(btrim(p_name), '') = '' then 'Someone'
    when array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) = 1 then btrim(p_name)
    else (regexp_split_to_array(btrim(p_name), '\s+'))[1] || ' ' || upper(left((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)], 1)) || '.'
  end
$$;
revoke execute on function public.client_request_short_name(text) from public, anon;
grant execute on function public.client_request_short_name(text) to authenticated, service_role;

-- The organization a coach's public page belongs to, by the same rule the page uses for its branding: one they OWN before one they only help run, then the oldest; a coach who only coaches in an organization gets its oldest.
create or replace function public.client_request_org(p_coach uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.organization_id from public.organization_memberships m join public.organizations o on o.id = m.organization_id
      where m.profile_id = p_coach and m.role in ('owner', 'admin') order by (m.role = 'owner') desc, o.created_at asc, o.id limit 1),
    (select m.organization_id from public.organization_memberships m join public.organizations o on o.id = m.organization_id
      where m.profile_id = p_coach order by o.created_at asc, o.id limit 1)
  )
$$;
revoke execute on function public.client_request_org(uuid) from public, anon, authenticated;

-- A visitor's request. Answers {ok: true, id} or {ok: false, code, message} (a refusal is an ANSWER, so the try is still recorded: a raised error would roll its own record back).
create or replace function public.submit_client_request(p_coach uuid, p_dob date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_org uuid;
  v_known date;
  v_dob date;
  v_id uuid;
  v_name text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  -- one try at a time per account and per coach, so two presses at once cannot both get past a limit or both make a request
  perform pg_advisory_xact_lock(hashtextextended('client_request:account:' || me::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('client_request:coach:' || coalesce(p_coach::text, ''), 0));
  delete from public.client_request_attempts where profile_id = me and at < now() - interval '2 days';
  if (select count(*) from public.client_request_attempts a where a.profile_id = me and a.at > now() - interval '1 hour') >= 5 then
    insert into public.client_request_attempts (profile_id, outcome) values (me, 'too_many');
    return jsonb_build_object('ok', false, 'code', 'too_many', 'message', 'Too many requests. Try again later.');
  end if;
  insert into public.client_request_attempts (profile_id, outcome) values (me, 'tried');

  -- the coach's public page must be on and taking requests, and the coach must belong to an organization (the one the page wears)
  v_org := public.client_request_org(p_coach);
  if p_coach is null or v_org is null or not exists (select 1 from public.coach_booking_pages p where p.coach_id = p_coach and p.enabled and p.accepts_requests) then
    return jsonb_build_object('ok', false, 'code', 'not_taking', 'message', 'This coach is not taking requests through this page.');
  end if;
  if p_coach = me then
    return jsonb_build_object('ok', false, 'code', 'own_page', 'message', 'This is your own page.');
  end if;
  if exists (select 1 from public.client_request_blocks b where b.profile_id = me and b.until > now()) then
    return jsonb_build_object('ok', false, 'code', 'under_13', 'message', 'Coaching here is for ages 13 and up. Ask a parent to contact the coach.');
  end if;
  -- the YOUNGER of the date on file (either of the two places it is kept) and the one typed now: a date typed to look older never wins
  select greatest((select ci.date_of_birth from public.client_intake ci where ci.athlete_id = me limit 1), (select d.birthday from public.athlete_profile_details d where d.athlete_id = me limit 1)) into v_known;
  if p_dob is not null and (p_dob > current_date or p_dob < date '1900-01-01') then
    return jsonb_build_object('ok', false, 'code', 'dob_invalid', 'message', 'That date of birth is not a real date.');
  end if;
  v_dob := greatest(v_known, p_dob);
  if v_dob is null then
    return jsonb_build_object('ok', false, 'code', 'dob_needed', 'message', 'Please enter your date of birth.');
  end if;
  if current_date < public.age_threshold_date(v_dob, 13) then
    insert into public.client_request_blocks (profile_id, until) values (me, now() + interval '30 days') on conflict (profile_id) do update set until = greatest(public.client_request_blocks.until, excluded.until);
    update public.client_request_attempts set outcome = 'under_13' where id = (select max(id) from public.client_request_attempts where profile_id = me);
    return jsonb_build_object('ok', false, 'code', 'under_13', 'message', 'Coaching here is for ages 13 and up. Ask a parent to contact the coach.');
  end if;
  if exists (
    select 1 from public.group_memberships a
    join public.group_memberships c on c.group_id = a.group_id and c.profile_id = p_coach and c.role = 'coach'
    join public.groups g on g.id = a.group_id and g.organization_id = v_org
    where a.profile_id = me and a.role = 'athlete'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_client', 'message', 'You already train with this coach.');
  end if;
  -- one waiting request per person for this coach: the same request comes back
  select r.id into v_id from public.client_requests r where r.coach_id = p_coach and r.organization_id = v_org and r.requester_id = me and r.status = 'pending';
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  -- a decline holds for 30 days with this coach
  if exists (select 1 from public.client_requests r where r.coach_id = p_coach and r.organization_id = v_org and r.requester_id = me and r.status = 'declined' and r.decided_at > now() - interval '30 days') then
    return jsonb_build_object('ok', false, 'code', 'declined_recently', 'message', 'This coach is not taking new clients right now. You can ask again later.');
  end if;
  if (select count(*) from public.client_requests r where r.coach_id = p_coach and r.status = 'pending') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'coach_full', 'message', 'This coach has a lot of requests waiting right now. Please try again later.');
  end if;
  if (select count(*) from public.client_requests r where r.coach_id = p_coach and r.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'message', 'Too many requests for this coach right now. Try again later.');
  end if;

  begin
    insert into public.client_requests (coach_id, organization_id, requester_id, requester_dob) values (p_coach, v_org, me, v_dob) returning id into v_id;
  exception when unique_violation then
    select r.id into v_id from public.client_requests r where r.coach_id = p_coach and r.organization_id = v_org and r.requester_id = me and r.status = 'pending';
    return jsonb_build_object('ok', true, 'id', v_id);
  end;

  -- the coach is told, by First L. only (the full name comes with Approve)
  select p.full_name into v_name from public.profiles p where p.id = me;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (p_coach, null, 'client_request', public.client_request_short_name(v_name) || ' asked to train with you.', '/clients/requests');
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke execute on function public.submit_client_request(uuid, date) from public, anon;
grant execute on function public.submit_client_request(uuid, date) to authenticated;

-- The coach's list for ONE organization (the one they are working in). EVERY waiting request is First L. with no photo, whatever date of birth was typed, under the request's own id (no account id): the full name and photo
-- appear after Approve.
create or replace function public.coach_client_requests(p_status text default 'pending', p_org uuid default null)
returns table (id uuid, display_name text, avatar_url text, age_band text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         public.client_request_short_name(p.full_name),
         null::text,
         case when r.requester_dob is null then 'unknown' when current_date >= public.age_threshold_date(r.requester_dob, 18) then 'adult' else 'teen' end,
         r.status, r.created_at
  from public.client_requests r
  join public.profiles p on p.id = r.requester_id
  where r.coach_id = auth.uid() and auth.uid() is not null and r.status = coalesce(nullif(p_status, ''), 'pending')
    and (p_org is null or r.organization_id = p_org)
  order by r.created_at desc
  limit 200
$$;
revoke execute on function public.coach_client_requests(text, uuid) from public, anon;
grant execute on function public.coach_client_requests(text, uuid) to authenticated;

create or replace function public.coach_client_request_count(p_org uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.client_requests r where r.coach_id = auth.uid() and auth.uid() is not null and r.status = 'pending' and (p_org is null or r.organization_id = p_org)
$$;
revoke execute on function public.coach_client_request_count(uuid) from public, anon;
grant execute on function public.coach_client_request_count(uuid) to authenticated;

create or replace function public.approve_client_request(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.client_requests%rowtype;
  v_dob date;
  v_group uuid;
  v_name text;
  v_coach_name text;
  v_band text;
  v_file date;
begin
  select * into r from public.client_requests where id = p_request for update;
  if not found or me is null or r.coach_id <> me then
    raise exception 'that request was not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'that request was already answered';
  end if;
  -- one approval at a time for this coach and person, so two presses cannot make two spaces
  perform pg_advisory_xact_lock(hashtextextended('client_request:approve:' || me::text || ':' || r.requester_id::text, 0));

  select p.full_name into v_name from public.profiles p where p.id = r.requester_id;
  select p.full_name into v_coach_name from public.profiles p where p.id = me;

  -- can the coach still take them? (still in the organization)
  if not exists (select 1 from public.organization_memberships m where m.organization_id = r.organization_id and m.profile_id = me) then
    update public.client_requests set status = 'expired', decided_at = now(), decided_by = me where id = r.id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.requester_id, null, 'client_request_answer', coalesce(nullif(btrim(v_coach_name), ''), 'The coach') || ' is not taking new clients right now.', '/');
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'You can no longer take clients there, so this request was closed. The person was told only that you are not taking new clients right now.');
  end if;

  -- the youngest date known now (on file, or the one given with the request)
  select greatest((select ci.date_of_birth from public.client_intake ci where ci.athlete_id = r.requester_id limit 1), (select d.birthday from public.athlete_profile_details d where d.athlete_id = r.requester_id limit 1), r.requester_dob) into v_dob;
  if v_dob is not null and current_date < public.age_threshold_date(v_dob, 13) then
    -- closed for good, not left waiting to reappear: the account is also held for 30 days, and the person gets the neutral notice only
    update public.client_requests set status = 'expired', decided_at = now(), decided_by = me where id = r.id;
    insert into public.client_request_blocks (profile_id, until) values (r.requester_id, now() + interval '30 days') on conflict (profile_id) do update set until = greatest(public.client_request_blocks.until, excluded.until);
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.requester_id, null, 'client_request_answer', coalesce(nullif(btrim(v_coach_name), ''), 'The coach') || ' is not taking new clients right now.', '/');
    return jsonb_build_object('ok', false, 'code', 'under_13', 'message', 'Coaching here is for ages 13 and up, so this request was closed.');
  end if;
  v_band := case when v_dob is null then 'unknown' when current_date >= public.age_threshold_date(v_dob, 18) then 'adult' else 'teen' end;

  -- A date already in client_intake (the one the sign-in age gate reads) can never be changed by a client, and it is not changed here. So if it says an OLDER age band than the date given with this request (on file 18 or over,
  -- typed 15), the two cannot both be right and approving would leave the person in the older band: the approval is refused, the request stays waiting, and the coach is told to have it corrected through support first.
  select ci.date_of_birth into v_file from public.client_intake ci where ci.athlete_id = r.requester_id limit 1;
  if v_file is not null and v_file < v_dob
     and (case when current_date >= public.age_threshold_date(v_file, 18) then 3 when current_date >= public.age_threshold_date(v_file, 13) then 2 else 1 end)
       <> (case when current_date >= public.age_threshold_date(v_dob, 18) then 3 when current_date >= public.age_threshold_date(v_dob, 13) then 2 else 1 end) then
    return jsonb_build_object('ok', false, 'code', 'dob_mismatch', 'message', 'The date of birth on file for this person puts them in an older age group than the one they gave with their request. Ask them to contact support to correct it, then approve. The request is still waiting.');
  end if;

  -- the same shape the Add client button makes: a one-on-one space named for the client, the coach as its coach, the person as its one client (an existing one with this coach is reused)
  select a.group_id into v_group
  from public.group_memberships a
  join public.group_memberships c on c.group_id = a.group_id and c.profile_id = me and c.role = 'coach'
  join public.groups g on g.id = a.group_id and g.organization_id = r.organization_id and g.group_kind = 'one_on_one'
  where a.profile_id = r.requester_id and a.role = 'athlete'
  limit 1;
  if v_group is null then
    v_group := gen_random_uuid();
    insert into public.groups (id, name, created_by, organization_id, group_kind) values (v_group, coalesce(nullif(btrim(v_name), ''), 'Client'), me, r.organization_id, 'one_on_one');
    insert into public.group_memberships (group_id, profile_id, role) values (v_group, me, 'coach');
    insert into public.group_memberships (group_id, profile_id, role) values (v_group, r.requester_id, 'athlete');
  end if;

  -- the date of birth in force goes to the person's records so a later screen cannot be used to type an older one: the profile's birthday takes it when it has none or an older one, and client_intake (which the sign-in age
  -- gate reads) takes it when it has no row or no date; a date already there is never overwritten (see above).
  if v_dob is not null then
    insert into public.athlete_profile_details (athlete_id, birthday) values (r.requester_id, v_dob) on conflict (athlete_id) do update set birthday = excluded.birthday where public.athlete_profile_details.birthday is null or public.athlete_profile_details.birthday < excluded.birthday;
    if exists (select 1 from public.client_intake ci where ci.athlete_id = r.requester_id) then
      update public.client_intake set date_of_birth = v_dob where athlete_id = r.requester_id and date_of_birth is null;
    else
      insert into public.client_intake (athlete_id, group_id, date_of_birth) values (r.requester_id, v_group, v_dob);
    end if;
  end if;

  update public.client_requests set status = 'approved', decided_at = now(), decided_by = me, result_group_id = v_group where id = r.id;

  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (r.requester_id, v_group, 'client_request_answer',
    coalesce(nullif(btrim(v_coach_name), ''), 'Your coach') || ' accepted your request. Open the app: it will take you through a short health form. '
      || case v_band when 'adult' then 'If you are under 18, a parent or guardian also has to sign a consent form before you can log workouts.'
                     else 'Because you are under 18, a parent or guardian has to sign a consent form before you can log workouts; the app walks you through it.' end,
    '/');
  return jsonb_build_object('ok', true, 'group_id', v_group, 'age_band', v_band);
end;
$$;
revoke execute on function public.approve_client_request(uuid) from public, anon;
grant execute on function public.approve_client_request(uuid) to authenticated;

create or replace function public.decline_client_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.client_requests%rowtype;
  v_coach_name text;
begin
  select * into r from public.client_requests where id = p_request for update;
  if not found or me is null or r.coach_id <> me then
    raise exception 'that request was not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'that request was already answered';
  end if;
  update public.client_requests set status = 'declined', decided_at = now(), decided_by = me where id = r.id;
  select p.full_name into v_coach_name from public.profiles p where p.id = me;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (r.requester_id, null, 'client_request_answer', coalesce(nullif(btrim(v_coach_name), ''), 'The coach') || ' is not taking new clients right now.', '/');
end;
$$;
revoke execute on function public.decline_client_request(uuid) from public, anon;
grant execute on function public.decline_client_request(uuid) to authenticated;

-- Every waiting request in one organization, answered with one decline (a wave of spam is one click). Each person gets the same neutral notice. Returns how many.
create or replace function public.decline_all_client_requests(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_coach_name text;
  v_count integer;
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  select p.full_name into v_coach_name from public.profiles p where p.id = me;
  with gone as (
    update public.client_requests set status = 'declined', decided_at = now(), decided_by = me
      where coach_id = me and organization_id = p_org and status = 'pending'
      returning requester_id
  ), told as (
    insert into public.notifications (profile_id, group_id, type, body, link_path)
      select g.requester_id, null, 'client_request_answer', coalesce(nullif(btrim(v_coach_name), ''), 'The coach') || ' is not taking new clients right now.', '/' from gone g
      returning 1
  )
  select count(*)::int into v_count from gone;
  return coalesce(v_count, 0);
end;
$$;
revoke execute on function public.decline_all_client_requests(uuid) from public, anon;
grant execute on function public.decline_all_client_requests(uuid) to authenticated;
