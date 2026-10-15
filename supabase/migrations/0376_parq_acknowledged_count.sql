-- Release CF: the health screening line on a client's Overview. A coach acknowledges "Health screening: 2 flagged" once; it stays gone until a NEW flagged answer makes the count higher.
-- This reuses the row that already says "this coach has seen this client's flagged screening" (athlete_injury_flag_acknowledgements: one row per coach and client, private to that coach by row
-- security) and adds the one number it needs: how many flagged answers the coach had seen. Existing rows keep it empty, which counts as zero, so the line shows once more for them.
-- Re-runnable.
alter table public.athlete_injury_flag_acknowledgements add column if not exists flagged_count integer;
