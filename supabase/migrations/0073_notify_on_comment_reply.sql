-- Extends the comment notification: replying to someone ELSE's comment
-- now also notifies that comment's author, not just the original post's
-- author — a reply is a conversation with the person you replied to, not
-- just an update to the post owner. Never double-notifies the same
-- person twice (e.g. the post author replying to their own post's
-- comment), and never notifies the commenter about their own action.
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
