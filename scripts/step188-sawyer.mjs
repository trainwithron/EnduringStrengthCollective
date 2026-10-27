// Step 188 (0436): Sawyer Steele's copy of "Big Sauce but still little sauce" was made mid-import. The paste copies in the days it is missing, only while the source program is
// exactly what the import wrote (its last day at 21:44:57 on Oct 26). This is that check: a fingerprint of every day, exercise and set of the source, in a fixed order.
// Shared by the paste builder (scripts/build-paste-files.mjs) and the paste test (scripts/sql-tests/paste-files.test.mjs), which seeds a smaller program under the same ids and puts
// that program's fingerprint in place of the live one.
export const SAWYER_SOURCE = "39dc737c-1f7e-43ff-a414-68dda082a1ed";
export const SAWYER_COPY = "84d908e7-7b92-4143-a1da-b810f120bce6";
export const SAWYER_SOURCE_FP_LIVE = "faee2d50f38600beeb855a7710f182da";
export const sawyerSourceFpSql = (programId = SAWYER_SOURCE) =>
  `(select md5(coalesce(string_agg(r, chr(10) order by r), '')) from (select concat_ws('|', w.week_number, w.day_index, w.title, w.notes, w.scheduled_date, e.exercise_order, e.exercise_name, e.tracked_fields::text, e.notes, e.display_name, e.movement_pattern_id, e.is_slot, e.slot_side, e.slot_tier, s.set_order, s.target_reps, s.target_weight, s.target_rpe, s.target_rir, s.target_tempo, s.target_time_seconds, s.target_height, s.target_distance, s.rep_min, s.rep_max, s.target_rest_seconds, s.target_rest_max_seconds, s.target_pace, s.set_type) as r from public.workouts w left join public.group_workout_exercises e on e.workout_id = w.id left join public.group_workout_exercise_sets s on s.group_workout_exercise_id = e.id where w.program_id = '${programId}') as x)`;
// The copy's 29 days as it was made (week 1 day 1 to week 5 day 5).
export const SAWYER_COPY_DAYS = [
  "b01e0b7c-efca-4648-b68c-1b2a452daecc", "98ddaaef-ae1e-4916-a549-e41e6c6e7e64", "4ebeee75-f643-467b-8fce-778127369de4", "6ae754cb-49be-476a-b39b-98d80ad7c561", "5e4c4c3f-d42d-4071-a065-b0cba433a377", "502722c9-958c-4ce4-a34f-2439d9f06b92",
  "21dde757-d49d-49ee-be95-cece14fcb339", "51607667-91d3-400a-97ba-bc46d28fa063", "440dd296-d06b-4f84-a62b-e367b28ccade", "a67f4957-d98a-46a6-a6d6-bc2a381ab447", "3849fb9f-1372-49f0-8b41-b84b66c461ef", "6f926d43-4f42-416f-8c10-0fb6849a222b",
  "8a31b6bc-a000-45f4-b18b-6fc33fe7f8cb", "0c14ed22-2911-40d9-9a55-bf5e0bad2de3", "d3f39a2d-90cc-40c5-b7d5-8ae089566ba9", "d7ea11c9-5dc0-4633-ba6d-46ef4df7921d", "08d2ff98-df09-445f-8118-712335bd6f4c", "79c2dc10-483a-4d2d-a6f5-750b0dc83136",
  "d43b7570-d29c-48bc-9bbd-96bb8289dace", "b2f2ccc0-8b57-4428-af4b-8da6b12de23f", "e6421ad9-9c67-45d1-a149-9a2aa6a7a04b", "7737ec44-cf76-4a78-94f7-22e0c639fffa", "960628b5-a92f-450d-b6d8-efb68c1e28da", "b577864d-eadc-42eb-9506-7dc1c7c15ff5",
  "86159c0f-bde8-45cf-ac25-51d967943b48", "4dc1fbeb-9dfb-47f8-941a-b9d1e24d4c33", "50e7172e-360f-4b65-8bdb-bd68f89e3b9b", "cffa5008-258c-43c5-b41d-c69236dacba4", "94ecb5f7-c640-402e-b54f-09a3bbd0962f",
];
export const SAWYER = "1ba45158-a419-49d4-916a-4807725677ac";
export const SAWYER_GROUP = "11111111-2222-3333-4444-555555555555";
export const SAWYER_SESSION = "072e7dd6-82eb-4550-9ca0-d4f32b6cd806";
// The days step 188 adds (the source's days the copy did not have): week 5 day 6 and weeks 6 to 8. The undo removes only workouts of the copy at these places that are not one of its 29.
export const SAWYER_ADDED_PLACES = "(5,6),(6,1),(6,2),(6,3),(6,4),(6,5),(6,6),(7,1),(7,2),(7,3),(7,4),(7,5),(7,6),(8,1),(8,2),(8,3),(8,4),(8,5),(8,6),(8,7)";
