import { createServerClient } from "@/lib/supabase/server";
import { FoodTrackingToggle } from "@/components/coach/nutrition/food-tracking-toggle";

// Reads one client's food-tracking switch and shows the toggle. A database that does not have the column yet (the Release N paste is pending) reads as on, with the toggle left out so
// a coach is never offered a switch that cannot save.
export async function FoodTrackingSwitch({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("group_memberships").select("food_tracking_enabled").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (error) return null;
  const enabled = (data as { food_tracking_enabled?: boolean | null } | null)?.food_tracking_enabled !== false;
  return <FoodTrackingToggle athleteId={athleteId} groupId={groupId} initialEnabled={enabled} clientFirstName={clientName.split(" ")[0] || "this client"} />;
}
