-- UNDO for step 179 (0427). Only if step 179 misbehaves. Puts the 15 read policies back on the per-row checks (the reverse of the same word-for-word swap) and drops the three functions.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $$
declare r record; q text;
begin
  for r in select tablename, policyname, qual from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename in ('programs','workouts','group_workout_exercises','group_workout_exercise_sets','athlete_sessions','session_exercises','set_logs','group_memberships','groups','workout_logs') and qual ~ 'my_(group|coached_group|admin_group)_ids\(\)' loop
    q := regexp_replace(r.qual, '\(([a-z_]+(\.[a-z_]+)?) IN \( SELECT my_group_ids\(\) AS my_group_ids\)\)', 'is_group_member(\1)', 'g');
    q := regexp_replace(q, '\(([a-z_]+(\.[a-z_]+)?) IN \( SELECT my_coached_group_ids\(\) AS my_coached_group_ids\)\)', 'is_group_coach(\1)', 'g');
    q := regexp_replace(q, '\(([a-z_]+(\.[a-z_]+)?) IN \( SELECT my_admin_group_ids\(\) AS my_admin_group_ids\)\)', 'is_org_admin_of_group(\1)', 'g');
    execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, q);
  end loop;
end $$;
drop function if exists public.my_group_ids();
drop function if exists public.my_coached_group_ids();
drop function if exists public.my_admin_group_ids();
commit;
