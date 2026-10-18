-- UNDO for step 157 (0405). Only if step 157 misbehaves. Puts the three notice functions back to the text migrations 0073 and 0093 gave them (full names in notices).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
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
  select full_name into v_commenter_name from public.profiles where id = new.author_id;

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
  select full_name into v_commenter_name from public.profiles where id = new.author_id;

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
  select full_name into v_author_name from public.profiles where id = new.author_id;

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
drop function if exists public.notice_display_name(uuid);
commit;
