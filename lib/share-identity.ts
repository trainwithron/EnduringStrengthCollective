import type { SupabaseClient } from "@supabase/supabase-js";
import { publicDisplayName } from "@/lib/public-name";
import { resolveShowName } from "@/lib/share-name";
import { isMinorDob } from "@/lib/youth-block";

// What a stranger sees of a person on a public celebration card (milestone, transformation): the same promise as the shared workout picture.
//   * The name is first name and last initial, or no name at all ("An athlete") when the client switched it off (profiles.show_name_on_share), or when they have not chosen and are
//     under 18 (the default depends on age, from the intake form's date of birth).
//   * A one-on-one space is named after the client, so the business name stands in for it.
//   * isMinor: the client is under 18 by their date of birth. Public cards are never made or shown for a minor (callers return nothing).
// Reads with the service role, so the caller passes that client.
export interface ShareIdentity {
  athleteName: string;
  groupName: string;
  isMinor: boolean;
}

export async function loadShareIdentity(supabase: SupabaseClient, athleteId: string, groupId: string): Promise<ShareIdentity> {
  const [profileRes, groupRes, intakeRes] = await Promise.all([
    supabase.from("profiles").select("full_name, show_name_on_share").eq("id", athleteId).maybeSingle(),
    supabase.from("groups").select("name, organization_id, group_kind").eq("id", groupId).maybeSingle(),
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle(),
  ]);
  // Before the show_name_on_share column exists the read errors; fall back to the name alone (shown, as it always was).
  let fullName: string | null = null;
  let stored: boolean | null = null;
  let columnThere = true;
  if (profileRes.error) {
    columnThere = false;
    const plain = await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    fullName = (plain.data as { full_name?: string | null } | null)?.full_name ?? null;
  } else {
    const row = profileRes.data as { full_name?: string | null; show_name_on_share?: boolean | null } | null;
    fullName = row?.full_name ?? null;
    stored = row?.show_name_on_share ?? null;
  }
  const dob = (intakeRes.data as { date_of_birth?: string | null } | null)?.date_of_birth ?? null;
  const hidden = columnThere && !resolveShowName(stored, dob);

  const group = groupRes.data as { name?: string | null; organization_id?: string | null; group_kind?: string | null } | null;
  let groupName = group?.name ?? "Spotlight Coaching";
  if (group?.group_kind === "one_on_one") {
    const { data: org } = group.organization_id
      ? await supabase.from("organizations").select("name").eq("id", group.organization_id).maybeSingle()
      : { data: null };
    groupName = (org as { name?: string | null } | null)?.name ?? "Spotlight Coaching";
  }

  return {
    athleteName: hidden ? "An athlete" : publicDisplayName(fullName),
    groupName,
    isMinor: isMinorDob(dob),
  };
}
