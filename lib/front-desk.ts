import type { SupabaseClient } from "@supabase/supabase-js";

// The front desk (migration 0400): a person an organization's owner or admin invited to check clients in. They are not an organization member and hold no group seat, so the rest of the app does not know them;
// they land on the front-desk screen and reach clients only through the database's front_desk_* functions (a name, the group to check in to, and whether a check-in code is set).
export const FRONT_DESK_PATH = "/front-desk";
export const FRONT_DESK_MIN_QUERY = 2;

export interface FrontDeskOrg {
  organization_id: string;
  name: string;
}

export interface FrontDeskMatch {
  athlete_id: string;
  group_id: string;
  // Already shortened by the database for anyone under 18 or of unknown age ("Sam R."); the screen shows exactly this and never asks for the full name.
  display_name: string | null;
  has_pin: boolean;
}

// Is this person on some organization's front desk? Reads only their own row. A failed read is "no" (they then land where they always did).
export async function isFrontDeskPerson(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("org_front_desk").select("organization_id").eq("profile_id", userId).limit(1);
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}

// Where a person lands: only someone whose ONLY role is the front desk (no group seat of any kind, so not a coach and not a client, and no organization membership, so not an owner, admin or coach of one) goes to the
// front-desk screen. Everyone else keeps their usual start and opens the screen from the Front desk link (the menu, Settings, or the Team page). A failed read means "not only the front desk".
export async function landsOnFrontDesk(supabase: SupabaseClient, userId: string, membership: { role: string } | null): Promise<boolean> {
  if (membership) return false;
  if (!(await isFrontDeskPerson(supabase, userId))) return false;
  try {
    const { data, error } = await supabase.from("organization_memberships").select("organization_id").eq("profile_id", userId).limit(1);
    return !error && (data ?? []).length === 0;
  } catch {
    return false;
  }
}

// What the check-in answers mean, in words the person at the desk can say out loud.
export function checkInMessage(result: string): string {
  switch (result) {
    case "wrong":
      return "That code is not right. Try again.";
    case "locked":
      return "Too many wrong tries. Try again later, or ask the client's coach.";
    case "throttled":
      return "Too many wrong codes just now. Wait a few minutes and try again.";
    case "no_pin":
      return "No check-in code is set for this client yet. Ask their coach to set one.";
    default:
      return "Couldn't check in. Try again.";
  }
}
