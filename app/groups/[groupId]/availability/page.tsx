import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AvailabilityManagerDesktop } from "@/components/coach/desktop/availability-manager-desktop";
import { CancellationPolicyControl } from "@/components/coach/desktop/cancellation-policy-control";
import { AvailabilityExceptionsManager } from "@/components/coach/desktop/availability-exceptions-manager";
import { DiscoveryCallsPanel, type DiscoveryCallRow } from "@/components/coach/desktop/discovery-calls-panel";
import { TimezoneControl } from "@/components/coach/desktop/timezone-control";

export default async function AvailabilityPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
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

  const { data: coachProfile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

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

  const { data: exceptionRows } = await supabase
    .from("coach_availability_exceptions")
    .select("id, kind, label, start_at, end_at, weekday, start_time, end_time")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: false });

  const { data: discoveryCallRows } = await supabase
    .from("discovery_bookings")
    .select("id, start_at, prospect_name, prospect_email, prospect_phone, message")
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });

  const discoveryCalls: DiscoveryCallRow[] = (discoveryCallRows ?? []).map((c) => ({
    id: c.id,
    startAt: c.start_at,
    prospectName: c.prospect_name,
    prospectEmail: c.prospect_email,
    prospectPhone: c.prospect_phone,
    message: c.message,
  }));

  const exceptions = (exceptionRows ?? []).map((e) => ({
    id: e.id,
    kind: e.kind as "one_off" | "recurring",
    label: e.label,
    startAt: e.start_at,
    endAt: e.end_at,
    weekday: e.weekday,
    startTime: e.start_time,
    endTime: e.end_time,
  }));

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

      <TimezoneControl initialTimezone={coachProfile?.timezone ?? null} />

      <CancellationPolicyControl
        coachId={user.id}
        initialHours={policyRow?.cancellation_window_hours ?? 24}
      />

      <AvailabilityExceptionsManager coachId={user.id} initialExceptions={exceptions} />

      <AvailabilityManagerDesktop coachId={user.id} initialWindows={windows} />

      <DiscoveryCallsPanel coachId={user.id} initialCalls={discoveryCalls} />
    </CoachDesktopShell>
  );
}
