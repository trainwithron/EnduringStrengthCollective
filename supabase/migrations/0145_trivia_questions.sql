-- Trivia flash-round content bank (custom_shape_theming_idea.md) —
-- workout/fitness true-false trivia, platform-wide (not per-org), since
-- this is generic reference content, not coach-authored data. Real
-- reliability requirement: a trivia question has one factually correct
-- answer, so an AI-hallucinated wrong "correct" answer would be a
-- genuine correctness bug, not just a taste miss. Same "AI drafts, human
-- reviews" pattern already established elsewhere in this app — a
-- question only becomes visible to athletes once approved, never
-- generated live and served unsupervised per-round.
create table public.trivia_questions (
  id uuid primary key default uuid_generate_v4(),
  category text not null default 'workout',
  statement text not null,
  correct_answer boolean not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index trivia_questions_status_idx on public.trivia_questions(status);

alter table public.trivia_questions enable row level security;
-- Any authenticated user can read the live, approved bank -- needed to
-- actually play. Only a platform admin manages the review queue, same
-- gate already used for the org/support admin pages.
create policy "trivia_questions_select_approved" on public.trivia_questions for select
  to authenticated using (status = 'approved');
create policy "trivia_questions_admin_manage" on public.trivia_questions for all
  to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
