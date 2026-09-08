import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AvailabilityManagerDesktop } from "@/components/coach/desktop/availability-manager-desktop";
import { CancellationPolicyControl } from "@/components/coach/desktop/cancellation-policy-control";

export default async function AvailabilityPage({
  params,
}: {
  params: { groupId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage availability.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: windowRows } = await supabase
    .from("coach_availability_windows")
    .select("id, weekday, start_time, end_time, slot_duration_minutes")
    .eq("coach_id", user.id)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  const windows = (windowRows ?? []).map((w) => ({
    id: w.id,
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
  }));

  const { data: policyRow } = await supabase
    .from("coach_booking_policies")
    .select("cancellation_window_hours")
    .eq("coach_id", user.id)
    .maybeSingle();

  return (
    <CoachDesktopShell
      groupId={params.groupId}
      groupName={group?.name ?? "Coaching"}
      active="availability"
    >
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Availability</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          These recurring hours are shared across every 1-on-1 client you
          coach — set once here, applies everywhere.
        </p>
      </div>

      <CancellationPolicyControl
        coachId={user.id}
        initialHours={policyRow?.cancellation_window_hours ?? 24}
      />

      <AvailabilityManagerDesktop coachId={user.id} initialWindows={windows} />
    </CoachDesktopShell>
  );
}
