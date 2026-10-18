import { createServerClient } from "@/lib/supabase/server";
import { AutoSuggestOffToggle, type AutoSuggestState } from "@/components/coach/nutrition/auto-suggest-off-toggle";

// Reads whether "no automatic suggestions" is in force for this person (here, or in another of their groups) and shows the line. The answer is one word from a database function that only a coach of this person's
// group can use; it never says which coach or group set it. A database that does not have the function yet (the Release B1 paste is pending) leaves the line out, so a coach is never offered a switch that cannot save.
export async function AutoSuggestOffSwitch({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("nutrition_auto_off_state", { p_group: groupId, p_profile: athleteId });
  if (error) return null;
  const state: AutoSuggestState = data === "this" || data === "other" ? data : "none";
  return <AutoSuggestOffToggle athleteId={athleteId} groupId={groupId} initialState={state} clientFirstName={clientName.trim().split(/\s+/)[0] || "this client"} />;
}
