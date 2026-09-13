-- Programming Spotter (programming_spotter_program_review_idea.md) —
-- dismissal memory. Keyed by program_id, not athlete_id directly: a
-- personal (per-client) program is already 1:1 with one athlete, so this
-- naturally gives "dismissing on one client's program never silences it
-- for a different client's" — a different client's flag lives on a
-- different program row entirely. A shared group program's dismissal
-- applies to that one shared program, same simple rule either way.
create table public.programming_spotter_dismissals (
  id uuid primary key default uuid_generate_v4(),
  program_id uuid not null references public.programs(id) on delete cascade,
  check_kind text not null check (check_kind in ('volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern')),
  pattern_key text not null,
  dismissed_count int not null default 1,
  last_dismissed_at timestamptz not null default now(),
  unique (program_id, check_kind, pattern_key)
);
create index programming_spotter_dismissals_program_id_idx on public.programming_spotter_dismissals(program_id);

alter table public.programming_spotter_dismissals enable row level security;
create policy "spotter_dismissals_coach_manage" on public.programming_spotter_dismissals for all
  to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id and public.is_group_coach(p.group_id)))
  with check (exists (select 1 from public.programs p where p.id = program_id and public.is_group_coach(p.group_id)));
