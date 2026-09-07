-- ============================================================================
-- Generic starter exercise library: seeds the coach's movement-pattern
-- ladders with a broad, standard set of exercises across common movement
-- patterns, each tagged with a priority tier:
--   A = primary/foundational compound lift for that pattern
--   B = solid secondary/accessory compound variation
--   C = isolation / accessory / regression-friendly option
-- (difficulty_rank still orders the regression->progression ladder within
-- a pattern; tier is an independent priority classification layered on top)
-- ============================================================================

alter table public.movement_pattern_exercises
  add column tier text check (tier in ('A', 'B', 'C'));

do $$
declare
  v_coach_id uuid := '11111111-1111-1111-1111-111111111111';
  v_pattern_id uuid;
begin
  -- Horizontal Push
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Horizontal Push')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Horizontal Push';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Push-up', 0, 'C'),
    (v_pattern_id, 'DB Bench Press', 1, 'B'),
    (v_pattern_id, 'Bench Press', 2, 'A'),
    (v_pattern_id, 'Incline DB Bench Press', 3, 'B'),
    (v_pattern_id, 'Cable Chest Fly', 4, 'C')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Horizontal Pull
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Horizontal Pull')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Horizontal Pull';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Inverted Row', 0, 'C'),
    (v_pattern_id, 'Chest-Supported DB Row', 1, 'B'),
    (v_pattern_id, 'Single-Arm DB Row', 2, 'B'),
    (v_pattern_id, 'Barbell Bent-Over Row', 3, 'A'),
    (v_pattern_id, 'Seated Cable Row', 4, 'B'),
    (v_pattern_id, 'Face Pull', 5, 'C')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Vertical Push
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Vertical Push')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Vertical Push';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Pike Push-up', 0, 'C'),
    (v_pattern_id, 'DB Shoulder Press', 1, 'B'),
    (v_pattern_id, 'Landmine Press', 2, 'B'),
    (v_pattern_id, 'Overhead Press', 3, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Vertical Pull
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Vertical Pull')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Vertical Pull';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Band-Assisted Pull-up', 0, 'C'),
    (v_pattern_id, 'Lat Pulldown', 1, 'B'),
    (v_pattern_id, 'Neutral-Grip Pulldown', 2, 'B'),
    (v_pattern_id, 'Chin-up', 3, 'A'),
    (v_pattern_id, 'Pull-up', 4, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Squat / Bilateral Knee-Dominant
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Squat (Bilateral Knee-Dominant)')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Squat (Bilateral Knee-Dominant)';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Bodyweight Squat', 0, 'C'),
    (v_pattern_id, 'Goblet Squat', 1, 'B'),
    (v_pattern_id, 'Leg Press', 2, 'B'),
    (v_pattern_id, 'Front Squat', 3, 'A'),
    (v_pattern_id, 'Back Squat', 4, 'A'),
    (v_pattern_id, 'Leg Extension', 5, 'C')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Hinge / Bilateral Hip-Dominant
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Hinge (Bilateral Hip-Dominant)')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Hinge (Bilateral Hip-Dominant)';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Kettlebell Deadlift', 0, 'C'),
    (v_pattern_id, 'Trap Bar Deadlift', 1, 'B'),
    (v_pattern_id, 'Romanian Deadlift', 2, 'A'),
    (v_pattern_id, 'Conventional Deadlift', 3, 'A'),
    (v_pattern_id, 'Back Extension', 4, 'C')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Unilateral Knee-Dominant (lunge / split squat / step-up)
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Unilateral Knee-Dominant')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Unilateral Knee-Dominant';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Bodyweight Reverse Lunge', 0, 'C'),
    (v_pattern_id, 'Step-Up', 1, 'B'),
    (v_pattern_id, 'DB Walking Lunge', 2, 'B'),
    (v_pattern_id, 'Bulgarian Split Squat', 3, 'A'),
    (v_pattern_id, 'Barbell Front-Foot-Elevated Split Squat', 4, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Unilateral Hip-Dominant
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Unilateral Hip-Dominant')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Unilateral Hip-Dominant';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Single-Leg Glute Bridge', 0, 'C'),
    (v_pattern_id, 'Single-Leg Hip Thrust', 1, 'B'),
    (v_pattern_id, 'DB Single-Leg RDL', 2, 'B'),
    (v_pattern_id, 'Barbell Hip Thrust', 3, 'A'),
    (v_pattern_id, 'Barbell Single-Leg RDL', 4, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Elbow Flexion (Biceps)
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Elbow Flexion (Biceps)')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Elbow Flexion (Biceps)';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Band Curl', 0, 'C'),
    (v_pattern_id, 'Incline DB Curl', 1, 'C'),
    (v_pattern_id, 'DB Curl', 2, 'B'),
    (v_pattern_id, 'Barbell Curl', 3, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Elbow Extension (Triceps)
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Elbow Extension (Triceps)')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Elbow Extension (Triceps)';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Bench Dip', 0, 'C'),
    (v_pattern_id, 'Overhead DB Tricep Extension', 1, 'C'),
    (v_pattern_id, 'Cable Tricep Pushdown', 2, 'B'),
    (v_pattern_id, 'Close-Grip Bench Press', 3, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Core - Anti-Extension
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Core - Anti-Extension')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Core - Anti-Extension';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Dead Bug', 0, 'C'),
    (v_pattern_id, 'Front Plank', 1, 'B'),
    (v_pattern_id, 'Stability Ball Stir-the-Pot', 2, 'B'),
    (v_pattern_id, 'Ab Wheel Rollout', 3, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Core - Anti-Rotation / Anti-Lateral Flexion
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Core - Anti-Rotation')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Core - Anti-Rotation';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Bird Dog', 0, 'C'),
    (v_pattern_id, 'Half-Kneeling Pallof Press', 1, 'B'),
    (v_pattern_id, 'Pallof Press', 2, 'A'),
    (v_pattern_id, 'Suitcase Carry', 3, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Core - Flexion / Rotation
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Core - Flexion/Rotation')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Core - Flexion/Rotation';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Crunch', 0, 'C'),
    (v_pattern_id, 'Hanging Knee Raise', 1, 'B'),
    (v_pattern_id, 'Cable Woodchop', 2, 'B'),
    (v_pattern_id, 'Hanging Leg Raise', 3, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Loaded Carry
  insert into public.movement_patterns (created_by, name) values (v_coach_id, 'Loaded Carry')
    on conflict (created_by, name) do nothing;
  select id into v_pattern_id from public.movement_patterns where created_by = v_coach_id and name = 'Loaded Carry';
  insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values
    (v_pattern_id, 'Single-Arm KB Carry', 0, 'B'),
    (v_pattern_id, 'DB Farmer''s Carry', 1, 'A'),
    (v_pattern_id, 'Trap Bar Carry', 2, 'A')
  on conflict (movement_pattern_id, exercise_name) do update set difficulty_rank = excluded.difficulty_rank, tier = excluded.tier;

  -- Grow the flat autocomplete library from everything just seeded, so
  -- every one of these names shows up in the exercise-name combobox too.
  insert into public.exercise_library (created_by, name)
  select distinct v_coach_id, mpe.exercise_name
  from public.movement_pattern_exercises mpe
  join public.movement_patterns mp on mp.id = mpe.movement_pattern_id
  where mp.created_by = v_coach_id
  on conflict (created_by, name) do nothing;
end $$;
