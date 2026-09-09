-- Same @mention notification as comments (0075), extended to the post
-- body itself — tagging someone in a new feed post now notifies them
-- too, not just in a reply.
create or replace function public.notify_on_post_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author_name text;
  v_member record;
begin
  if new.body is null or new.post_type <> 'user_post' then
    return new;
  end if;
  select full_name into v_author_name from public.profiles where id = new.author_id;

  for v_member in
    select gm.profile_id, p.full_name
    from public.group_memberships gm
    join public.profiles p on p.id = gm.profile_id
    where gm.group_id = new.group_id
      and gm.profile_id <> new.author_id
      and p.full_name is not null
      and new.body like '%@' || p.full_name || '%'
  loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      v_member.profile_id,
      new.group_id,
      'comment',
      coalesce(v_author_name, 'Someone') || ' mentioned you in a post',
      '/groups/' || new.group_id || '/feed'
    );
  end loop;

  return new;
end;
$$;
create trigger trg_notify_on_post_mention after insert on public.posts
for each row execute function public.notify_on_post_mention();
