import { createServerClient } from "@/lib/supabase/server";
import { FoodCheckinsToggle } from "@/components/coach/nutrition/food-checkins-toggle";

// "Food check-ins: On/Off" for one client in this group (Nov 24): whether the Nutrition Spotter may send them a food check-in in the coach's name. Read as the coach (only a coach of
// the group can read the switches). A read that fails (the step 227 paste is pending) leaves the line out, so a coach is never offered a switch that cannot save.
export async function FoodCheckinsSwitch({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("client_nutrition_flags").select("checkins_off").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (error) return null;
  const on = (data as { checkins_off?: boolean | null } | null)?.checkins_off !== true;
  return <FoodCheckinsToggle athleteId={athleteId} groupId={groupId} initialOn={on} clientFirstName={clientName.trim().split(/\s+/)[0] || "this client"} />;
}
