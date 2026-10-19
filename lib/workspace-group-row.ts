import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { LAST_WORKSPACE_GROUP_COOKIE, decodeWorkspaceCookie } from "@/lib/workspace-header";

export interface WorkspaceGroupRow {
  id: string;
  organization_id: string | null;
  team_mode: boolean | null;
}

// The remembered workspace's group row, read ONCE per request (SPEED, Oct 19): the root layout's colors (lib/org-theme-server.ts) and team words (lib/team-words-server.ts) both need it.
// Row security limits it, so a group the viewer cannot see is null. `failed` is a read error (the callers then fall back as before).
export const getWorkspaceGroupRow = cache(async (): Promise<{ row: WorkspaceGroupRow | null; failed: boolean }> => {
  try {
    const groupId = decodeWorkspaceCookie((await cookies()).get(LAST_WORKSPACE_GROUP_COOKIE)?.value);
    if (!groupId) return { row: null, failed: false };
    const supabase = await createServerClient();
    const { data, error } = await supabase.from("groups").select("id, organization_id, team_mode").eq("id", groupId).maybeSingle();
    if (error) return { row: null, failed: true };
    return { row: (data as WorkspaceGroupRow | null) ?? null, failed: false };
  } catch {
    return { row: null, failed: true };
  }
});
