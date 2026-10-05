-- Several programs can be active for one client at once (a main program, a
-- mobility program on off days, a warm-up flow). These two columns let the
-- coach name each one's role and say what order they appear in on the
-- athlete's Today view. Both are optional: with neither set, programs show
-- under their own name, oldest first, exactly as before.
alter table public.programs
  add column if not exists label text,
  add column if not exists sort_order integer;

comment on column public.programs.label is
  'Short role shown to the athlete: Main, Mobility, Warm-up, Conditioning, or anything the coach types.';
comment on column public.programs.sort_order is
  'Lower numbers show first on the athlete Today view. Null sorts after numbered programs, oldest first.';
