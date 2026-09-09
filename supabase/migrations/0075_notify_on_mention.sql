-- @mentions in a comment notify whoever was tagged, resolved against
-- real group member names (not the client's lightweight display-only
-- regex) — matches "@Full Name" as a literal substring of the comment
-- body against every member of that post's group, skipping the
-- commenter mentioning themselves. A separate trigger from
-- notify_on_comment (0071/0073) so a mention and a "commented on your
-- post"/"replied to your comment" notification can both legitimately
-- fire for the same comment without entangling the two.
create or replace function public.notify_on_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
  v_commenter_name text;
  v_member record;
begin
  select group_id into v_group_id from public.posts where id = new.post_id;
  if v_group_id is null then
    return new;
  end if;
  select full_name into v_commenter_name from public.profiles where id = new.author_id;

  for v_member in
    select gm.profile_id, p.full_name
    from public.group_memberships gm
    join public.profiles p on p.id = gm.profile_id
    where gm.group_id = v_group_id
      and gm.profile_id <> new.author_id
      and p.full_name is not null
      and new.body like '%@' || p.full_name || '%'
  loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      v_member.profile_id,
      v_group_id,
      'comment',
      coalesce(v_commenter_name, 'Someone') || ' mentioned you in a comment',
      '/groups/' || v_group_id || '/feed'
    );
  end loop;

  return new;
end;
$$;
create trigger trg_notify_on_mention after insert on public.comments
for each row execute function public.notify_on_mention();
