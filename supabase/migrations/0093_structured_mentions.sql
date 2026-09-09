-- @mention notifications used to fuzzy-match `new.body like '%@' || p.full_name || '%'`
-- against every group member — two real bugs: `%`/`_` in a name are LIKE
-- wildcards, unescaped, and a shorter name that's a text-prefix of a
-- longer one (e.g. "Bob" vs "Bob Smith") false-matches whenever the
-- longer name is actually mentioned, notifying the wrong extra person.
--
-- The real fix isn't a smarter regex — both composers (the post composers
-- and the comment box) already have a real autocomplete dropdown that
-- picks one specific, disambiguated member; the bug was throwing that
-- certainty away and re-deriving "who was mentioned" from fuzzy text
-- matching afterward. Now the exact profile IDs selected through
-- autocomplete are captured at compose time and stored directly — no
-- text matching in the trigger at all.
alter table public.posts add column mentioned_profile_ids uuid[] not null default '{}'::uuid[];
alter table public.comments add column mentioned_profile_ids uuid[] not null default '{}'::uuid[];

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
    -- Only notify a real, current member of this post's group — a
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
