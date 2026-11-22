-- UNDO: step 222. Only if it must be taken back: drops the feed's channel index (nothing reads differently without it; the feed is only slower on a big group). Last result: one row, all true.

begin;

drop index if exists public.posts_group_channel_created;

commit;

-- Check: one row, all true.
select
  not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'posts_group_channel_created') as index_gone;
