import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE_NAME, LAST_WORKSPACE_GROUP_COOKIE, decodeWorkspaceCookie } from "@/lib/workspace-header";
import { NO_TEAM_WORDS_HINT, isTeamSportGroup, orgIsTeamOnly, type TeamWordsHint } from "@/lib/team-sport";

// For the root layout: is the remembered workspace a team? Read once per request. Signed out, no cookie or any failure gives "no hint" (the words are then worked out in the browser as before).
// The group read is limited by row security, so a group the viewer cannot see answers nothing.
export const getTeamWordsHint = cache(async (): Promise<TeamWordsHint> => {
  try {
    const jar = await cookies();
    const groupId = decodeWorkspaceCookie(jar.get(LAST_WORKSPACE_GROUP_COOKIE)?.value);
    if (!groupId) return NO_TEAM_WORDS_HINT;
    const chosenOrg = decodeWorkspaceCookie(jar.get(ACTIVE_ORG_COOKIE_NAME)?.value);
    const supabase = await createServerClient();
    const { data: group, error } = await supabase.from("groups").select("organization_id, team_mode").eq("id", groupId).maybeSingle();
    if (error || !group) return NO_TEAM_WORDS_HINT;
    const groupTeamSport = isTeamSportGroup((group as { team_mode?: boolean | null }).team_mode);
    let orgTeamOnly = false;
    const organizationId = (group as { organization_id?: string | null }).organization_id;
    // FIX 4: a remembered group of ANOTHER organization than the one chosen says nothing about the words (they are worked out in the browser).
    if (chosenOrg && organizationId && organizationId !== chosenOrg) return NO_TEAM_WORDS_HINT;
    if (organizationId) {
      const { data: orgGroups, error: orgError } = await supabase.from("groups").select("team_mode").eq("organization_id", organizationId).limit(500);
      orgTeamOnly = !orgError && orgIsTeamOnly((orgGroups ?? []) as { team_mode?: boolean | null }[]);
    }
    return { groupId, groupTeamSport, orgTeamOnly };
  } catch {
    return NO_TEAM_WORDS_HINT;
  }
});
