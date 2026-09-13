-- Package-Program Linking (package_program_linking_scoping.md) —
-- coach_packages had zero connection to programs: buying/being assigned
-- a package granted session credits and nothing else, leaving a coach to
-- separately remember to assign a program by hand. One nullable column;
-- delivery reuses the existing duplicateProgram() function as-is (see
-- app/api/stripe/webhook/route.ts and app/api/coach/package-assignments/
-- route.ts), not a new assignment system.
alter table public.coach_packages
  add column default_program_id uuid references public.programs(id) on delete set null;
