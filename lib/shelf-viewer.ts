import type { SupabaseClient } from "@supabase/supabase-js";
import { athleteIsMinor } from "@/lib/youth-block";
import type { ShelfViewer } from "@/lib/shelf";

// Who is looking at the shelf, for the audience rules: the client whose Home or Pro Shop it is (the person a coach is acting as, when they are), whether their space with this coach is a one-on-one
// space, every group they belong to, and whether they are known to be under 18. A coach looking at their own shelf sees everything.
export async function loadShelfViewer(
  supabase: SupabaseClient,
  { groupKind, athleteId, coachPreview }: { groupKind: string | null | undefined; athleteId: string; coachPreview: boolean }
): Promise<ShelfViewer> {
  if (coachPreview) return { isCoach: true, oneOnOne: false, groupIds: [], isMinor: false };
  const [{ data: seats }, isMinor] = await Promise.all([
    supabase.from("group_memberships").select("group_id").eq("profile_id", athleteId),
    athleteIsMinor(supabase, athleteId).catch(() => false),
  ]);
  return {
    isCoach: false,
    oneOnOne: groupKind === "one_on_one",
    groupIds: ((seats ?? []) as { group_id: string }[]).map((s) => s.group_id),
    isMinor,
  };
}
