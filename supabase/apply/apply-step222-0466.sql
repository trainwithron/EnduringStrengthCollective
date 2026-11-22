-- PASTE: step 222 (a faster feed: one index on posts for the channel tabs). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Step 222 (clutter round 2, Nov 21: the feed shows a tab only for a channel that has posts, CL17). The feed now asks, per channel, "is there a post here?" and reads a channel's
-- newest posts. This index makes both quick on a big group. It only adds speed: nothing reads differently with or without it. Re-running is safe.
create index if not exists posts_group_channel_created on public.posts (group_id, channel, created_at desc);

commit;

-- Check: one row, all true.
select
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'posts' and indexname = 'posts_group_channel_created') as index_exists,
  coalesce((select array_agg(a.attname::text order by k.ord)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
     cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where c.relname = 'posts_group_channel_created' and c.relnamespace = 'public'::regnamespace) = array['group_id', 'channel', 'created_at'], false) as on_group_channel_created,
  coalesce(position('created_at DESC' in (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'posts_group_channel_created')) > 0, false) as newest_first;
