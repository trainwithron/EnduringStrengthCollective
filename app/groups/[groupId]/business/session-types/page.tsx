import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { SessionTypeManager, type SessionTypeRow } from "@/components/coach/desktop/session-type-manager";

// gym_owner_multi_trainer_session_tracking_real_prospect.md — coach-wide,
// not group-scoped (a session type isn't tied to one specific client's
// group), same as coach_availability_windows. Reached from any group's
// Business nav.
export default async function SessionTypesPage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can manage session types.</p>
      </main>
    );
  }

  const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).single();

  const { data: typeRows } = await supabase
    .from("session_types")
    .select("id, name, credit_cost")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: true });

  const types: SessionTypeRow[] = (typeRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    creditCost: t.credit_cost,
  }));

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="session-types">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Session Types</h1>
      </div>
      <SessionTypeManager initialTypes={types} />
    </CoachDesktopShell>
  );
}
