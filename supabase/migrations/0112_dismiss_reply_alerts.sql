-- Lets a coach explicitly clear a "Needs a reply" dashboard alert without
-- having to actually reply — the alert still self-clears on a real reply
-- (findThreadsNeedingReply just sees the coach's own comment as the
-- latest), this is the manual escape hatch for "I saw it, not important."
-- A dismissal only suppresses the thread up to the moment it was
-- dismissed: if a newer non-coach reply lands after that, the thread
-- reappears — so this table stores a timestamp, not a boolean.
create table public.coach_dismissed_reply_alerts (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (coach_id, post_id)
);

alter table public.coach_dismissed_reply_alerts enable row level security;

create policy "coach_dismissed_reply_alerts_own" on public.coach_dismissed_reply_alerts for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));
