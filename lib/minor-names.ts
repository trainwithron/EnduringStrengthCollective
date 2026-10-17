import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ageStatusFromDob } from "@/lib/youth-block";

// A member under 18 is shown to the rest of the group as a first name and a last initial ("Sam R."), never the full name, on the shared boards: the leaderboard, the records board and a challenge's
// standings. Only a known date of birth under 18 counts here (a person with no date yet is asked for one on their next visit); an adult is shown as before. The date of birth lives where only
// coaches can read it, so the check is made on the server with the service role and only the ids of the under-18s come back.
export async function loadMinorProfileIds(groupIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (groupIds.length === 0) return out;
  try {
    const db = createServiceRoleClient();
    const { data: seats } = await db.from("group_memberships").select("profile_id").in("group_id", groupIds).eq("role", "athlete");
    const ids = Array.from(new Set((seats ?? []).map((s: { profile_id: string }) => s.profile_id)));
    if (ids.length === 0) return out;
    const { data: intakes } = await db.from("client_intake").select("athlete_id, date_of_birth").in("athlete_id", ids);
    for (const row of (intakes ?? []) as Array<{ athlete_id: string; date_of_birth: string | null }>) {
      if (ageStatusFromDob(row.date_of_birth) === "minor") out.add(row.athlete_id);
    }
  } catch {
    // If the check cannot be made, nobody is shown by full name that might be a minor: callers treat a failed lookup as "everyone shortened" (see shownName).
    return new Set(["*"]);
  }
  return out;
}
