-- The shared machine list, with Ron's say on what goes on it (Ron, Nov 19: "I like a master shared machine list, but I definitely want to be the one that has the final say...
-- someone wants to add it to the public... send a request and I could approve or deny it depending on the video quality"; "I was hoping that my video demos would populate for
-- everyone. Especially on the specialty equipment").
-- 1. catalog_machines: a machine on the shared list (a brand and a model, for example Bolt + Viking Press). Every signed-in person reads it; only the platform admin changes it.
-- 2. catalog_machine_exercises: the exercises done on it, in order, each an exercise_catalog entry, each with one demo (a filmed video in the machine-demos bucket and/or a YouTube
--    link; the filmed video is shown when there are both). Read and changed like catalog_machines.
-- 3. catalog_requests: what a coach sends Ron: a new machine (brand, model, exercises) or a demo for one exercise on a shared machine. Only the coach who sent it and the platform
--    admin read it; a coach can only send (pending, unreviewed); nobody changes it but review_catalog_request(), which checks the platform admin on the server.
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

drop policy if exists "catalog_requests_read_own_or_admin" on public.catalog_requests;
create policy "catalog_requests_read_own_or_admin" on public.catalog_requests for select to authenticated
  using (submitted_by = (select auth.uid()) or public.is_platform_admin());
drop policy if exists "catalog_requests_send_own" on public.catalog_requests;
create policy "catalog_requests_send_own" on public.catalog_requests for insert to authenticated
  with check (submitted_by = (select auth.uid()) and status = 'pending' and review_note is null and reviewed_at is null);

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

-- The platform admin's review. Approve: a machine goes on the shared list (its exercises added after any already there; an exercise not in the exercise catalog yet is added to it),
-- a demo becomes that exercise's demo. Deny: nothing goes public. Either way the coach sees the outcome and the note.
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
        insert into public.catalog_machine_exercises (machine_id, catalog_exercise_id, position) values (v_machine, v_cat, v_pos)
          on conflict (machine_id, catalog_exercise_id) do nothing;
        if found then
          v_pos := v_pos + 1;
        end if;
      end loop;
    else
      update public.catalog_machine_exercises
        set video_path = coalesce(r.video_path, video_path), youtube_url = coalesce(r.youtube_url, youtube_url)
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
  with check (bucket_id = 'machine-demos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists machine_demos_select on storage.objects;
create policy machine_demos_select on storage.objects for select to authenticated
  using (bucket_id = 'machine-demos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_platform_admin() or public.is_catalog_demo_object(name)));
