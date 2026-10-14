import { createServerClient } from "@/lib/supabase/server";
import { MacrosOffToggle } from "@/components/coach/nutrition/macros-off-toggle";

// Reads one client's "coach sets macros" switch and shows the line. A database that does not have the column yet (the Release BZ paste is pending) reads as on, with the line left out so a coach is never
// offered a switch that cannot save.
export async function MacrosOffSwitch({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("group_memberships").select("coach_sets_macros").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (error) return null;
  const off = (data as { coach_sets_macros?: boolean | null } | null)?.coach_sets_macros === false;
  return <MacrosOffToggle athleteId={athleteId} groupId={groupId} initialOff={off} clientFirstName={clientName.trim().split(/\s+/)[0] || "this client"} />;
}
