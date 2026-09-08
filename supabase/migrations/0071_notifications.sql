-- In-app notifications: comments on your own post, a program getting
-- assigned to you, and macros getting set for you. Created server-side
-- via triggers on the real underlying tables rather than trusting a
-- client insert — a client only ever reads/marks-read their own rows.
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  type text not null check (type in ('comment', 'program_assigned', 'macros_assigned')),
  body text not null,
  link_path text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile_unread_idx on public.notifications (profile_id, created_at desc);

alter table public.notifications enable row level security;
create policy "notifications_select_own" on public.notifications for select
  to authenticated using (profile_id = auth.uid());
create policy "notifications_update_own" on public.notifications for update
  to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- No insert/delete policy for authenticated — only the trigger functions
-- below (SECURITY DEFINER) ever create a notification.

-- A comment on your post notifies you — never notifies yourself when you
-- comment on your own post.
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post_author uuid;
  v_group_id uuid;
  v_commenter_name text;
begin
  select author_id, group_id into v_post_author, v_group_id from public.posts where id = new.post_id;
  if v_post_author is null or v_post_author = new.author_id then
    return new;
  end if;
  select full_name into v_commenter_name from public.profiles where id = new.author_id;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (
    v_post_author,
    v_group_id,
    'comment',
    coalesce(v_commenter_name, 'Someone') || ' commented on your post',
    '/groups/' || v_group_id || '/feed'
  );
  return new;
end;
$$;
create trigger trg_notify_on_comment after insert on public.comments
for each row execute function public.notify_on_comment();

-- A personal program becoming active for an athlete notifies them —
-- covers both "Assign to Client" (insert) and a coach flipping an
-- existing personal program active later (update).
create or replace function public.notify_on_program_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.athlete_id is not null and new.is_active = true
     and (tg_op = 'INSERT' or (old.is_active is distinct from new.is_active) or (old.athlete_id is distinct from new.athlete_id)) then
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      new.athlete_id,
      new.group_id,
      'program_assigned',
      'Your coach assigned you a new program: ' || new.name,
      '/groups/' || new.group_id || '/programs/' || new.id
    );
  end if;
  return new;
end;
$$;
create trigger trg_notify_on_program_assigned after insert or update on public.programs
for each row execute function public.notify_on_program_assigned();

-- New or changed macro targets for a specific day notify that athlete.
create or replace function public.notify_on_macros_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (
    new.athlete_id,
    new.group_id,
    'macros_assigned',
    'Your coach set new macro targets for ' || to_char(new.log_date, 'Mon DD'),
    '/groups/' || new.group_id
  );
  return new;
end;
$$;
create trigger trg_notify_on_macros_assigned after insert or update on public.daily_macros
for each row execute function public.notify_on_macros_assigned();
