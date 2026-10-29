-- UNDO step 192 (0439): removes the five page text columns (and anything typed in them), puts Why pick me back to 3 lines (keeps the first 3), and clears Ron's wording.
begin;
update public.coach_sites set headline = null, who_i_help = null, what_i_do = null, why_lines = '{}' where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8';
update public.coach_sites set why_lines = why_lines[1:3] where cardinality(why_lines) > 3;
alter table public.coach_sites drop constraint if exists coach_sites_why_lines_check;
alter table public.coach_sites add constraint coach_sites_why_lines_check check (cardinality(why_lines) <= 3);
alter table public.coach_sites drop column if exists eyebrow, drop column if exists facts, drop column if exists packages_note, drop column if exists tagline, drop column if exists consult_note;
commit;
