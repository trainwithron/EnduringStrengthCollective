-- corrective_exercise_biomechanical_tagging_idea.md — the hidden
-- biomechanical exercise-tagging layer. Two tables: a seeded controlled
-- vocabulary (biomech_tags, both axes via a kind discriminator) and the
-- actual tagging join table (exercise_biomech_tags), keyed by exercise
-- NAME rather than exercise_library.id — the same convention already
-- established by movement_pattern_exercises.exercise_name and
-- exercise_aliases.exercise_name, and the reason tagging "Bulgarian
-- Split Squat" once covers every coach's own copy of it instead of once
-- per coach. Fully internal per Ron's own framing ("your internal
-- notes, or the AI's internal notes") — never client-visible, and never
-- shown to a coach who isn't one (RLS below is coach-only both ways).

create table public.biomech_tags (
  id uuid primary key default uuid_generate_v4(),
  kind text not null check (kind in ('joint_action', 'stabilization')),
  key text not null unique,
  label text not null,
  joint text,
  description text not null
);

create table public.exercise_biomech_tags (
  id uuid primary key default uuid_generate_v4(),
  exercise_name text not null,
  tag_id uuid not null references public.biomech_tags(id) on delete cascade,
  role text not null check (role in ('prime_mover', 'stabilizer_demand')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (exercise_name, tag_id)
);
create index exercise_biomech_tags_name_idx on public.exercise_biomech_tags(exercise_name);
create index exercise_biomech_tags_tag_idx on public.exercise_biomech_tags(tag_id);

alter table public.biomech_tags enable row level security;
-- The vocabulary itself is a fixed, curated reference set — read-only to
-- any coach (never athletes), seeded via this migration, not app CRUD.
create policy "biomech_tags_select_coach" on public.biomech_tags for select
  to authenticated using (
    exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  );

alter table public.exercise_biomech_tags enable row level security;
-- A genuinely shared, collaborative layer by design (see header comment)
-- — any real coach account can tag any exercise name, same "full-library
-- coverage as an ongoing pipeline" reasoning the original scoping used.
-- Never athlete-readable, matching the "fully internal" requirement.
create policy "exercise_biomech_tags_select_coach" on public.exercise_biomech_tags for select
  to authenticated using (
    exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  );
create policy "exercise_biomech_tags_write_coach" on public.exercise_biomech_tags for all
  to authenticated
  using (
    exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  )
  with check (
    exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  );

-- Axis A — joint-action tags. A real, bounded joint x anatomical-action
-- cross-product, deliberately the same vocabulary a goniometric ROM
-- assessment already uses (see the memory file's own reasoning), so it
-- can later double as the vocabulary for a client movement-limitation
-- record with zero translation layer.
insert into public.biomech_tags (kind, key, label, joint, description) values
('joint_action', 'shoulder_flexion', 'Shoulder Flexion', 'shoulder', 'Raising the arm forward, away from the body, in the sagittal plane.'),
('joint_action', 'shoulder_extension', 'Shoulder Extension', 'shoulder', 'Moving the arm backward behind the body, in the sagittal plane.'),
('joint_action', 'shoulder_abduction', 'Shoulder Abduction', 'shoulder', 'Raising the arm out to the side, away from the midline, in the frontal plane.'),
('joint_action', 'shoulder_adduction', 'Shoulder Adduction', 'shoulder', 'Pulling the arm in toward the midline of the body.'),
('joint_action', 'shoulder_horizontal_abduction', 'Shoulder Horizontal Abduction', 'shoulder', 'Moving the arm backward across the body while held out to the side, roughly parallel to the floor.'),
('joint_action', 'shoulder_horizontal_adduction', 'Shoulder Horizontal Adduction', 'shoulder', 'Moving the arm across the front of the body while held out to the side, roughly parallel to the floor.'),
('joint_action', 'shoulder_internal_rotation', 'Shoulder Internal Rotation', 'shoulder', 'Rotating the upper arm inward, toward the midline, around its long axis.'),
('joint_action', 'shoulder_external_rotation', 'Shoulder External Rotation', 'shoulder', 'Rotating the upper arm outward, away from the midline, around its long axis.'),

('joint_action', 'scapula_upward_rotation', 'Scapular Upward Rotation', 'scapula', 'The shoulder blade''s lower point rotates outward and up, as the arm lifts overhead.'),
('joint_action', 'scapula_downward_rotation', 'Scapular Downward Rotation', 'scapula', 'The shoulder blade''s lower point rotates inward and down, as the arm lowers.'),
('joint_action', 'scapula_protraction', 'Scapular Protraction', 'scapula', 'The shoulder blade slides forward and around the rib cage, away from the spine.'),
('joint_action', 'scapula_retraction', 'Scapular Retraction', 'scapula', 'The shoulder blade pulls back toward the spine.'),
('joint_action', 'scapula_elevation', 'Scapular Elevation', 'scapula', 'The shoulder blade lifts, as in a shrug.'),
('joint_action', 'scapula_depression', 'Scapular Depression', 'scapula', 'The shoulder blade pulls down, away from the ears.'),

('joint_action', 'elbow_flexion', 'Elbow Flexion', 'elbow', 'Bending the elbow, bringing the hand toward the shoulder.'),
('joint_action', 'elbow_extension', 'Elbow Extension', 'elbow', 'Straightening the elbow.'),

('joint_action', 'forearm_pronation', 'Forearm Pronation', 'forearm', 'Rotating the forearm so the palm faces down or backward.'),
('joint_action', 'forearm_supination', 'Forearm Supination', 'forearm', 'Rotating the forearm so the palm faces up or forward.'),

('joint_action', 'wrist_flexion', 'Wrist Flexion', 'wrist', 'Bending the wrist so the palm moves toward the forearm.'),
('joint_action', 'wrist_extension', 'Wrist Extension', 'wrist', 'Bending the wrist so the back of the hand moves toward the forearm.'),
('joint_action', 'wrist_radial_deviation', 'Wrist Radial Deviation', 'wrist', 'Bending the wrist toward the thumb side.'),
('joint_action', 'wrist_ulnar_deviation', 'Wrist Ulnar Deviation', 'wrist', 'Bending the wrist toward the pinky side.'),

('joint_action', 'cervical_flexion', 'Cervical Flexion', 'spine_cervical', 'Bending the neck forward, chin toward chest.'),
('joint_action', 'cervical_extension', 'Cervical Extension', 'spine_cervical', 'Extending the neck backward, chin away from chest.'),
('joint_action', 'cervical_rotation', 'Cervical Rotation', 'spine_cervical', 'Turning the head to one side.'),
('joint_action', 'cervical_lateral_flexion', 'Cervical Lateral Flexion', 'spine_cervical', 'Tilting the ear toward the shoulder.'),

('joint_action', 'thoracic_flexion', 'Thoracic Flexion', 'spine_thoracic', 'Rounding the upper back forward.'),
('joint_action', 'thoracic_extension', 'Thoracic Extension', 'spine_thoracic', 'Arching the upper back, opening the chest.'),
('joint_action', 'thoracic_rotation', 'Thoracic Rotation', 'spine_thoracic', 'Twisting the upper back to one side, independent of the hips.'),
('joint_action', 'thoracic_lateral_flexion', 'Thoracic Lateral Flexion', 'spine_thoracic', 'Side-bending the upper back.'),

('joint_action', 'lumbar_flexion', 'Lumbar Flexion', 'spine_lumbar', 'Rounding the lower back forward.'),
('joint_action', 'lumbar_extension', 'Lumbar Extension', 'spine_lumbar', 'Arching the lower back.'),
('joint_action', 'lumbar_rotation', 'Lumbar Rotation', 'spine_lumbar', 'Twisting the lower back to one side — a small range compared to the thoracic spine, and often a point of vulnerability under load.'),
('joint_action', 'lumbar_lateral_flexion', 'Lumbar Lateral Flexion', 'spine_lumbar', 'Side-bending the lower back.'),

('joint_action', 'hip_flexion', 'Hip Flexion', 'hip', 'Bringing the thigh up toward the torso.'),
('joint_action', 'hip_extension', 'Hip Extension', 'hip', 'Driving the thigh backward, behind the body.'),
('joint_action', 'hip_abduction', 'Hip Abduction', 'hip', 'Moving the thigh out to the side, away from the midline.'),
('joint_action', 'hip_adduction', 'Hip Adduction', 'hip', 'Pulling the thigh in toward the midline.'),
('joint_action', 'hip_internal_rotation', 'Hip Internal Rotation', 'hip', 'Rotating the thigh inward, toward the midline, around its long axis.'),
('joint_action', 'hip_external_rotation', 'Hip External Rotation', 'hip', 'Rotating the thigh outward, away from the midline, around its long axis.'),

('joint_action', 'knee_flexion', 'Knee Flexion', 'knee', 'Bending the knee, heel toward the glutes.'),
('joint_action', 'knee_extension', 'Knee Extension', 'knee', 'Straightening the knee.'),

('joint_action', 'ankle_dorsiflexion', 'Ankle Dorsiflexion', 'ankle', 'Pulling the top of the foot up toward the shin.'),
('joint_action', 'ankle_plantarflexion', 'Ankle Plantarflexion', 'ankle', 'Pointing the foot down, away from the shin.'),
('joint_action', 'ankle_inversion', 'Ankle Inversion', 'ankle', 'Rolling the sole of the foot inward, toward the midline.'),
('joint_action', 'ankle_eversion', 'Ankle Eversion', 'ankle', 'Rolling the sole of the foot outward, away from the midline.'),

-- Axis B — stabilization/chain-demand tags. A smaller, separate fixed
-- list from McGill's anti-movement corrective vocabulary and
-- Vleeming/Myers' fascial-sling anatomy.
('stabilization', 'anti_rotation', 'Anti-Rotation', null, 'Resisting an external force that would otherwise rotate the trunk — the core works isometrically to keep the spine facing forward.'),
('stabilization', 'anti_extension', 'Anti-Extension', null, 'Resisting an external force that would otherwise arch the lower back — the core works isometrically to keep the spine from extending.'),
('stabilization', 'anti_flexion', 'Anti-Flexion', null, 'Resisting an external force that would otherwise round the lower back — the core works isometrically to keep the spine from flexing.'),
('stabilization', 'anti_lateral_flexion', 'Anti-Lateral Flexion', null, 'Resisting an external force that would otherwise side-bend the trunk — the core works isometrically to keep the spine upright.'),
('stabilization', 'unilateral_loading', 'Unilateral Loading', null, 'One side of the body carries the load, demanding real single-side stability.'),
('stabilization', 'contralateral_loading', 'Contralateral Loading', null, 'The load is offset to one side (e.g. one hand), demanding the opposite side''s core/hip musculature to resist tipping toward it.'),
('stabilization', 'posterior_oblique_sling', 'Posterior Oblique Sling', null, 'The lat and the opposite-side glute work together through the thoracolumbar fascia — the sling behind the body that transfers force diagonally across the back, e.g. in a rotational throw or a crawling pattern.'),
('stabilization', 'anterior_oblique_sling', 'Anterior Oblique Sling', null, 'The adductors and the opposite-side external oblique work together across the front of the pelvis — the sling that powers a diagonal, rotational push or kick.'),
('stabilization', 'deep_longitudinal_sling', 'Deep Longitudinal Sling', null, 'The erector spinae, sacrotuberous ligament, and biceps femoris work together in a vertical line from the upper back down through the hamstring — the sling that transfers force straight through the body, e.g. catching a landing.'),
('stabilization', 'lateral_sling', 'Lateral Sling', null, 'The glute medius and the opposite-side adductors work together to control the pelvis in the frontal plane — the sling that keeps the hips level on one leg.'),
('stabilization', 'closed_kinetic_chain', 'Closed Kinetic Chain', null, 'The hand or foot stays planted against a fixed surface while the rest of the body moves around it (e.g. a squat, a push-up).'),
('stabilization', 'open_kinetic_chain', 'Open Kinetic Chain', null, 'The hand or foot moves freely through space, unattached to a fixed surface (e.g. a leg extension, a dumbbell curl).'),
('stabilization', 'single_leg_stance', 'Single-Leg Stance', null, 'The body balances and moves on one leg at a time, demanding real frontal- and transverse-plane hip control most bilateral work never challenges.'),
('stabilization', 'reactive_ballistic', 'Reactive/Ballistic', null, 'A fast, explosive, often elastic movement — the muscle-tendon unit stores and releases energy quickly rather than moving under smooth, controlled tension.');
