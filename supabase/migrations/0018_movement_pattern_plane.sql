-- ============================================================================
-- Plane of motion classification for movement patterns (sagittal / frontal /
-- transverse), so a coach can filter the movement-pattern library by which
-- plane a pattern trains. One value per pattern, not per exercise within its
-- ladder — plane of motion is a property of the movement itself.
-- ============================================================================

alter table public.movement_patterns
  add column plane text check (plane in ('sagittal', 'frontal', 'transverse'));

update public.movement_patterns set plane = 'sagittal'
where name in (
  'Horizontal Push', 'Horizontal Pull', 'Vertical Push', 'Vertical Pull',
  'Squat (Bilateral Knee-Dominant)', 'Hinge (Bilateral Hip-Dominant)',
  'Unilateral Knee-Dominant', 'Unilateral Hip-Dominant',
  'Elbow Flexion (Biceps)', 'Elbow Extension (Triceps)',
  'Core - Anti-Extension'
);

update public.movement_patterns set plane = 'transverse'
where name in ('Core - Anti-Rotation', 'Core - Flexion/Rotation');

update public.movement_patterns set plane = 'frontal'
where name = 'Loaded Carry';
