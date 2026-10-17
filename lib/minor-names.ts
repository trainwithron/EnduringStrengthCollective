import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ageStatusFromDob } from "@/lib/youth-block";
import { chunk } from "@/lib/chunk";

// A member who is not a confirmed adult is shown to the rest of the group as a first name and a last initial ("Sam R."), never the full name, on the shared boards: the leaderboard, the records board and a
// challenge's standings. That is a member under 18 AND a member whose age is not known (no date of birth on file, or no health form yet): a child who has not filled in the form must not be the one shown in
// full. Only someone whose date of birth says 18 or over is shown as before. The date of birth lives where only coaches can read it, so the check is made on the server with the service role.
//
// The check is made for the profile ids that are actually ON the board or page being shown (not the group's current seats): a member who has left the group, or a challenge participant from another group,
// is still on the page and still protected. If the lookup cannot be made (an error answer or a thrown error), everyone is shortened ("*"), never the other way round.
export type ProtectIds = (profileIds: string[]) => Promise<Set<string>>;

export const loadNameProtectedIds: ProtectIds = async (profileIds) => {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  const out = new Set<string>();
  if (ids.length === 0) return out;
  try {
    const db = createServiceRoleClient();
    const adults = new Set<string>();
    for (const group of chunk(ids, 100)) {
      const { data, error } = await db.from("client_intake").select("athlete_id, date_of_birth").in("athlete_id", group);
      if (error) return new Set(["*"]);
      for (const row of (data ?? []) as Array<{ athlete_id: string; date_of_birth: string | null }>) {
        if (ageStatusFromDob(row.date_of_birth) === "adult") adults.add(row.athlete_id);
      }
    }
    for (const id of ids) if (!adults.has(id)) out.add(id);
  } catch {
    return new Set(["*"]);
  }
  return out;
};
