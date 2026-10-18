import { createServerClient } from "@/lib/supabase/server";
import { AutoSuggestOffToggle } from "@/components/coach/nutrition/auto-suggest-off-toggle";

// Reads one client's "no automatic suggestions" note and shows the line. A database that does not have the table yet (the Release B1 paste is pending) leaves the line out, so a coach is never offered a switch
// that cannot save.
export async function AutoSuggestOffSwitch({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("client_nutrition_flags").select("auto_off").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (error) return null;
  const off = (data as { auto_off?: boolean | null } | null)?.auto_off === true;
  return <AutoSuggestOffToggle athleteId={athleteId} groupId={groupId} initialOff={off} clientFirstName={clientName.trim().split(/\s+/)[0] || "this client"} />;
}
