-- Release W2b: the bell notices that name a person ("X commented on your post", "X replied to your comment", "X mentioned you in a comment / a post") are written by database triggers that used the person's full name.
-- A member under 18, or whose age is not known, now appears in them as a first name and last initial ("Sam R."), the same rule as the feed and the leaderboards. A coach, and an owner or admin who is not also a client,
-- is an adult in charge and is named in full.
--
--   notice_display_name(profile)   the name to put in a notice that other people will read
--   notify_on_comment, notify_on_mention, notify_on_post_mention   exactly as before (migrations 0073 and 0093), except for the name
-- Notices already written keep the name they were written with. This replaces three existing functions, so it is not an additions-only step. Re-runnable.
create or replace function public.notice_display_name(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.full_name is null or btrim(p.full_name) = '' then null
    when exists (select 1 from public.group_memberships c where c.profile_id = p.id and c.role = 'coach') then btrim(p.full_name)
    when exists (select 1 from public.organization_memberships o where o.profile_id = p.id and o.role in ('owner', 'admin'))
         and not exists (select 1 from public.group_memberships a where a.profile_id = p.id and a.role = 'athlete') then btrim(p.full_name)
    when ci.date_of_birth is not null and ci.date_of_birth + interval '18 years' <= current_date then btrim(p.full_name)
    when cardinality(regexp_split_to_array(btrim(p.full_name), '\s+')) = 1 then btrim(p.full_name)
    else (regexp_split_to_array(btrim(p.full_name), '\s+'))[1] || ' ' || upper(left((regexp_split_to_array(btrim(p.full_name), '\s+'))[cardinality(regexp_split_to_array(btrim(p.full_name), '\s+'))], 1)) || '.'
  end
  from public.profiles p
  left join public.client_intake ci on ci.athlete_id = p.id
  where p.id = p_profile
$$;
revoke execute on function public.notice_display_name(uuid) from public, anon, authenticated;

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post_author uuid;
  v_group_id uuid;
  v_commenter_name text;
  v_parent_author uuid;
begin
  select author_id, group_id into v_post_author, v_group_id from public.posts where id = new.post_id;
  if v_post_author is null then
    return new;
  end if;
  v_commenter_name := public.notice_display_name(new.author_id);

  if v_post_author <> new.author_id then
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      v_post_author,
      v_group_id,
      'comment',
      coalesce(v_commenter_name, 'Someone') || ' commented on your post',
      '/groups/' || v_group_id || '/feed'
    );
  end if;

  if new.parent_comment_id is not null then
    select author_id into v_parent_author from public.comments where id = new.parent_comment_id;
    if v_parent_author is not null and v_parent_author <> new.author_id and v_parent_author <> v_post_author then
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (
        v_parent_author,
        v_group_id,
        'comment',
        coalesce(v_commenter_name, 'Someone') || ' replied to your comment',
        '/groups/' || v_group_id || '/feed'
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
  v_commenter_name text;
  v_target_id uuid;
begin
  select group_id into v_group_id from public.posts where id = new.post_id;
  if v_group_id is null or new.mentioned_profile_ids is null then
    return new;
  end if;
  v_commenter_name := public.notice_display_name(new.author_id);

  foreach v_target_id in array new.mentioned_profile_ids
  loop
    -- Only notify a real, current member of this post's group - a
    -- mention captured at compose time could otherwise point at someone
    -- who's since left, or (defense in depth) an id the client didn't
    -- legitimately have available to pick from.
    if v_target_id <> new.author_id
       and exists (
         select 1 from public.group_memberships
         where group_id = v_group_id and profile_id = v_target_id
       )
    then
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (
        v_target_id,
        v_group_id,
        'comment',
        coalesce(v_commenter_name, 'Someone') || ' mentioned you in a comment',
        '/groups/' || v_group_id || '/feed'
      );
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.notify_on_post_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author_name text;
  v_target_id uuid;
begin
  if new.post_type <> 'user_post' or new.mentioned_profile_ids is null then
    return new;
  end if;
  v_author_name := public.notice_display_name(new.author_id);

  foreach v_target_id in array new.mentioned_profile_ids
  loop
    if v_target_id <> new.author_id
       and exists (
         select 1 from public.group_memberships
         where group_id = new.group_id and profile_id = v_target_id
       )
    then
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (
        v_target_id,
        new.group_id,
        'comment',
        coalesce(v_author_name, 'Someone') || ' mentioned you in a post',
        '/groups/' || new.group_id || '/feed'
      );
    end if;
  end loop;

  return new;
end;
$$;
