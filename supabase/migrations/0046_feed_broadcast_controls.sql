-- Per-athlete control over what a completed workout broadcasts to the
-- feed. `profiles.feed_broadcast_level` is the athlete's current setting
-- (read at completion time); `posts.broadcast_level` freezes whichever
-- level was chosen at the moment a post was created, so the card renders
-- consistently even if the athlete later changes their preference.
alter table public.profiles
  add column feed_broadcast_level text not null default 'full'
    check (feed_broadcast_level in ('full', 'prs_only', 'checkin_only', 'private'));

alter table public.posts
  add column broadcast_level text not null default 'full'
    check (broadcast_level in ('full', 'prs_only', 'checkin_only'));
