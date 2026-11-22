-- Step 222 (clutter round 2, Nov 21: the feed shows a tab only for a channel that has posts, CL17). The feed now asks, per channel, "is there a post here?" and reads a channel's
-- newest posts. This index makes both quick on a big group. It only adds speed: nothing reads differently with or without it. Re-running is safe.
create index if not exists posts_group_channel_created on public.posts (group_id, channel, created_at desc);
