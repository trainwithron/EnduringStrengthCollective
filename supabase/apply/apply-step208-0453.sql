-- PASTE: step 208 (the shared machine list with Ron's approval: coaches search it and add a machine to their gym, send new machines and demo videos, Ron approves or denies). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- The shared machine list, with Ron's say on what goes on it (Ron, Nov 19: "I like a master shared machine list, but I definitely want to be the one that has the final say...
-- someone wants to add it to the public... send a request and I could approve or deny it depending on the video quality"; "I was hoping that my video demos would populate for
-- everyone. Especially on the specialty equipment").
-- 1. catalog_machines: a machine on the shared list (a brand and a model, for example Bolt + Viking Press). Every signed-in person reads it; only the platform admin changes it.
-- 2. catalog_machine_exercises: the exercises done on it, in order, each an exercise_catalog entry, each with one demo (a filmed video in the machine-demos bucket or a YouTube
--    link; an approved demo replaces the one there; were there ever both, the filmed video is shown). Read and changed like catalog_machines.
-- 3. catalog_requests: what a coach sends Ron: a new machine (brand, model, exercises) or a demo for one exercise on a shared machine. Only the coach who sent it and the platform
--    admin read it; only someone who coaches a group sends one (never an athlete), pending and unreviewed; nobody changes it but review_catalog_request(), which checks the platform admin on the server.
--    A demo request needs the tick "I filmed this video and have the right to share it". At most 50 waiting requests a coach.
-- 4. review_catalog_request(id, approve, note): the platform admin approves (it goes on the shared list) or denies (nothing goes public), with an optional note the coach sees.
-- 5. gym_machines.catalog_machine_id and gym_machine_exercises.catalog_item_id: a coach's machine added from the shared list stays LINKED to it, so its demos are read from the
--    shared list live (when Ron fixes or adds a video every gym sees it). Removing it from the shared list leaves the coach's machine as their own.
-- 6. Storage bucket machine-demos (private, videos only, 350 MB like exercise-media): a coach uploads only into their own folder; a file is readable by the coach who uploaded it,
--    the platform admin, and, once it is a demo on the shared list, every signed-in person. Nobody signed out reads anything here (the public QR pages use the server's key).
-- Nothing existing changes: the coach's own machines and the org wall are as before. Re-running is safe.

create table if not exists public.catalog_machines (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (char_length(btrim(brand)) between 1 and 60),
  model text not null check (char_length(btrim(model)) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists catalog_machines_brand_model_key on public.catalog_machines (lower(brand), lower(model));

create table if not exists public.catalog_machine_exercises (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.catalog_machines(id) on delete cascade,
  catalog_exercise_id uuid not null references public.exercise_catalog(id) on delete cascade,
  position int not null default 0,
  video_path text check (video_path is null or char_length(video_path) between 1 and 300),
  youtube_url text check (youtube_url is null or char_length(youtube_url) between 1 and 300),
  unique (machine_id, catalog_exercise_id)
);
create index if not exists catalog_machine_exercises_exercise_idx on public.catalog_machine_exercises (catalog_exercise_id);
create index if not exists catalog_machine_exercises_video_idx on public.catalog_machine_exercises (video_path) where video_path is not null;

create table if not exists public.catalog_requests (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('machine', 'demo')),
  -- a new machine: its brand, model and exercises ([{"name": "...", "catalogId": "<exercise_catalog id>" or null}])
  brand text,
  model text,
  exercises jsonb,
  -- a demo: the exercise on a shared machine, and the filmed video (in the coach's own machine-demos folder) or the YouTube link
  item_id uuid references public.catalog_machine_exercises(id) on delete cascade,
  video_path text,
  youtube_url text,
  rights_confirmed boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint catalog_requests_shape check (
    (
      kind = 'machine'
      and char_length(btrim(coalesce(brand, ''))) between 1 and 60
      and char_length(btrim(coalesce(model, ''))) between 1 and 80
      and jsonb_typeof(exercises) = 'array'
      and jsonb_array_length(exercises) between 1 and 30
      and pg_column_size(exercises) <= 16384
      and item_id is null and video_path is null and youtube_url is null
    )
    or (
      kind = 'demo'
      and item_id is not null
      and rights_confirmed
      and (video_path is not null or youtube_url is not null)
      and not (video_path is not null and youtube_url is not null)
      and (video_path is null or (char_length(video_path) <= 300 and split_part(video_path, '/', 1) = submitted_by::text))
      and (youtube_url is null or (char_length(youtube_url) <= 300 and youtube_url ~* '^https://(www[.]|m[.])?(youtube[.]com|youtu[.]be)/'))
      and brand is null and model is null and exercises is null
    )
  )
);
create index if not exists catalog_requests_submitted_by_idx on public.catalog_requests (submitted_by, created_at desc);
create index if not exists catalog_requests_pending_idx on public.catalog_requests (created_at) where status = 'pending';

alter table public.gym_machines add column if not exists catalog_machine_id uuid references public.catalog_machines(id) on delete set null;
alter table public.gym_machine_exercises add column if not exists catalog_item_id uuid references public.catalog_machine_exercises(id) on delete set null;
create index if not exists gym_machines_catalog_idx on public.gym_machines (catalog_machine_id) where catalog_machine_id is not null;
create index if not exists gym_machine_exercises_catalog_item_idx on public.gym_machine_exercises (catalog_item_id) where catalog_item_id is not null;

alter table public.catalog_machines enable row level security;
alter table public.catalog_machine_exercises enable row level security;
alter table public.catalog_requests enable row level security;
revoke all on public.catalog_machines from anon, authenticated;
revoke all on public.catalog_machine_exercises from anon, authenticated;
revoke all on public.catalog_requests from anon, authenticated;
grant select, insert, update, delete on public.catalog_machines to authenticated;
grant select, insert, update, delete on public.catalog_machine_exercises to authenticated;
grant select, insert on public.catalog_requests to authenticated;

drop policy if exists "catalog_machines_read" on public.catalog_machines;
create policy "catalog_machines_read" on public.catalog_machines for select to authenticated using (true);
drop policy if exists "catalog_machines_admin_write" on public.catalog_machines;
create policy "catalog_machines_admin_write" on public.catalog_machines for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "catalog_machine_exercises_read" on public.catalog_machine_exercises;
create policy "catalog_machine_exercises_read" on public.catalog_machine_exercises for select to authenticated using (true);
drop policy if exists "catalog_machine_exercises_admin_write" on public.catalog_machine_exercises;
create policy "catalog_machine_exercises_admin_write" on public.catalog_machine_exercises for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Whether the signed-in person coaches a group: only coaches send requests and upload demo videos (an athlete, who may be a minor, never does).
create or replace function public.is_any_group_coach()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.group_memberships where profile_id = (select auth.uid()) and role = 'coach')
$$;
revoke all on function public.is_any_group_coach() from public, anon;
grant execute on function public.is_any_group_coach() to authenticated;

drop policy if exists "catalog_requests_read_own_or_admin" on public.catalog_requests;
create policy "catalog_requests_read_own_or_admin" on public.catalog_requests for select to authenticated
  using (submitted_by = (select auth.uid()) or public.is_platform_admin());
drop policy if exists "catalog_requests_send_own" on public.catalog_requests;
create policy "catalog_requests_send_own" on public.catalog_requests for insert to authenticated
  with check (submitted_by = (select auth.uid()) and status = 'pending' and review_note is null and reviewed_at is null and public.is_any_group_coach());

-- At most 50 waiting requests a coach.
create or replace function public.limit_catalog_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.catalog_requests where submitted_by = new.submitted_by and status = 'pending') >= 50 then
    raise exception 'You have 50 requests waiting for review. Wait for those to be reviewed, then send more.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_catalog_requests() from public, anon, authenticated;
drop trigger if exists limit_catalog_requests on public.catalog_requests;
create trigger limit_catalog_requests before insert on public.catalog_requests for each row execute function public.limit_catalog_requests();

-- The platform admin's review. Approve: a machine goes on the shared list (its exercises added after any already there; an exercise not in the exercise catalog yet is added to it;
-- gyms that already added the machine get the new exercises too), a demo becomes that exercise's demo. Deny: nothing goes public. Either way the coach sees the outcome and the note.
create or replace function public.review_catalog_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.catalog_requests%rowtype;
  v_machine uuid;
  v_pos int;
  v_name text;
  v_cat uuid;
  v_raw text;
  v_item uuid;
  v_new uuid[] := '{}';
  v_lib uuid;
  g record;
  it record;
  e jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform admin reviews shared-list requests.' using errcode = '42501';
  end if;
  select * into r from public.catalog_requests where id = p_request_id for update;
  if not found then
    raise exception 'That request is gone.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'That request was already reviewed.' using errcode = '23514';
  end if;

  if p_approve then
    if r.kind = 'machine' then
      insert into public.catalog_machines (brand, model) values (btrim(r.brand), btrim(r.model))
        on conflict ((lower(brand)), (lower(model))) do nothing;
      select id into v_machine from public.catalog_machines where lower(brand) = lower(btrim(r.brand)) and lower(model) = lower(btrim(r.model));
      select coalesce(max(position) + 1, 0) into v_pos from public.catalog_machine_exercises where machine_id = v_machine;
      for e in select value from jsonb_array_elements(r.exercises) loop
        v_cat := null;
        v_raw := e ->> 'catalogId';
        if v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          select id into v_cat from public.exercise_catalog where id = v_raw::uuid;
        end if;
        if v_cat is null then
          v_name := regexp_replace(btrim(coalesce(e ->> 'name', '')), '[[:space:]]+', ' ', 'g');
          continue when char_length(v_name) not between 1 and 80;
          select id into v_cat from public.exercise_catalog where lower(name) = lower(v_name);
          if v_cat is null then
            insert into public.exercise_catalog (name, batch) values (v_name, 'machine-catalog')
              on conflict ((lower(name))) do nothing returning id into v_cat;
            if v_cat is null then
              select id into v_cat from public.exercise_catalog where lower(name) = lower(v_name);
            end if;
          end if;
        end if;
        v_item := null;
        insert into public.catalog_machine_exercises (machine_id, catalog_exercise_id, position) values (v_machine, v_cat, v_pos)
          on conflict (machine_id, catalog_exercise_id) do nothing returning id into v_item;
        if v_item is not null then
          v_new := v_new || v_item;
          v_pos := v_pos + 1;
        end if;
      end loop;

      -- Gyms that already added this machine get its new exercises too (Ron: anyone with that machine "pulls up that specific one and shows all the exercises listed"), in the
      -- list's order, after their own: each in the owning coach's library (their row with that catalog exercise, else one with the same name, else a new one, as Add to my gym
      -- does), linked to the shared exercise so its demo is read from the list. One already on the gym's machine is skipped; one the coach's library cannot take is skipped.
      for g in select id, created_by from public.gym_machines where catalog_machine_id = v_machine order by created_at, id loop
        for it in
          select x.id, x.catalog_exercise_id, c.name, c.category
          from public.catalog_machine_exercises x join public.exercise_catalog c on c.id = x.catalog_exercise_id
          where x.id = any (v_new)
          order by x.position
        loop
          continue when exists (select 1 from public.gym_machine_exercises l where l.machine_id = g.id and l.catalog_item_id = it.id);
          v_lib := null;
          select id into v_lib from public.exercise_library where created_by = g.created_by and catalog_id = it.catalog_exercise_id order by created_at, id limit 1;
          if v_lib is null then
            select id into v_lib from public.exercise_library where created_by = g.created_by and lower(btrim(name)) = lower(btrim(it.name)) order by created_at, id limit 1;
          end if;
          if v_lib is null then
            begin
              insert into public.exercise_library (created_by, name, catalog_id, category) values (g.created_by, it.name, it.catalog_exercise_id, it.category) returning id into v_lib;
            exception when others then
              v_lib := null;
            end;
          end if;
          continue when v_lib is null;
          insert into public.gym_machine_exercises (machine_id, exercise_id, position, catalog_item_id)
            values (g.id, v_lib, (select coalesce(max(position) + 1, 0) from public.gym_machine_exercises where machine_id = g.id), it.id)
            on conflict (machine_id, exercise_id) do nothing;
        end loop;
      end loop;
    else
      -- The approved demo replaces the one there (a request is a video or a link, never both): a link approved over a filmed video shows, since the filmed one always wins.
      update public.catalog_machine_exercises
        set video_path = r.video_path, youtube_url = r.youtube_url
        where id = r.item_id;
      if not found then
        raise exception 'That exercise is no longer on the shared list.' using errcode = 'P0002';
      end if;
    end if;
  end if;

  update public.catalog_requests
    set status = case when p_approve then 'approved' else 'denied' end,
        review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
        reviewed_at = now()
    where id = p_request_id;
  return case when p_approve then 'approved' else 'denied' end;
end;
$$;
revoke all on function public.review_catalog_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_catalog_request(uuid, boolean, text) to authenticated;

-- Whether a stored file is a demo on the shared list.
create or replace function public.is_catalog_demo_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.catalog_machine_exercises where video_path = p_name)
$$;
revoke all on function public.is_catalog_demo_object(text) from public, anon;
grant execute on function public.is_catalog_demo_object(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('machine-demos', 'machine-demos', false, 367001600, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

drop policy if exists machine_demos_insert_own_folder on storage.objects;
create policy machine_demos_insert_own_folder on storage.objects for insert to authenticated
  with check (bucket_id = 'machine-demos' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_any_group_coach());
drop policy if exists machine_demos_select on storage.objects;
create policy machine_demos_select on storage.objects for select to authenticated
  using (bucket_id = 'machine-demos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_platform_admin() or public.is_catalog_demo_object(name)));

commit;

-- Check: one row, all true.
select
  to_regclass('public.catalog_machines') is not null and to_regclass('public.catalog_machine_exercises') is not null and to_regclass('public.catalog_requests') is not null as shared_list_tables,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_machines' and column_name = 'catalog_machine_id')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_machine_exercises' and column_name = 'catalog_item_id') as gym_machines_link,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.catalog_machines'::regclass, 'public.catalog_machine_exercises'::regclass, 'public.catalog_requests'::regclass)) as row_security_on,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_machines' and policyname = 'catalog_machines_admin_write')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_machine_exercises' and policyname = 'catalog_machine_exercises_admin_write')
    and not has_table_privilege('authenticated', 'public.catalog_requests', 'update')
    and not has_table_privilege('authenticated', 'public.catalog_requests', 'delete') as only_ron_changes_it,
  (select prosecdef from pg_proc where oid = 'public.review_catalog_request(uuid, boolean, text)'::regprocedure)
    and pg_get_functiondef('public.review_catalog_request(uuid, boolean, text)'::regprocedure) like '%is_platform_admin()%'
    and not has_function_privilege('anon', 'public.review_catalog_request(uuid, boolean, text)', 'execute') as review_checks_admin,
  exists (select 1 from storage.buckets where id = 'machine-demos' and public = false)
    and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'machine_demos_select')
    and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'machine_demos_insert_own_folder') as private_video_bucket,
  not has_table_privilege('anon', 'public.catalog_machines', 'select') and not has_table_privilege('anon', 'public.catalog_machine_exercises', 'select')
    and not has_table_privilege('anon', 'public.catalog_requests', 'select') as nobody_signed_out;
