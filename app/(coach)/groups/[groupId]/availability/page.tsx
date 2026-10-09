import { redirect } from "next/navigation";
import { redirectOneOnOneToAnchor } from "@/lib/coach-wide-redirect";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AvailabilityManagerDesktop } from "@/components/coach/desktop/availability-manager-desktop";
import { BookingPolicyControl } from "@/components/coach/desktop/booking-policy-control";
import { ReupNudgeToggle } from "@/components/coach/desktop/reup-nudge-toggle";
import { ExpiryHeadsUpControl } from "@/components/coach/desktop/expiry-heads-up-control";
import { BookingModeSelect, type BookingMode } from "@/components/coach/desktop/booking-mode-select";
import { AvailabilityExceptionsManager } from "@/components/coach/desktop/availability-exceptions-manager";
import { TimezoneControl } from "@/components/coach/desktop/timezone-control";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

export default async function AvailabilityPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  await redirectOneOnOneToAnchor(params.groupId, "availability");
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
      <NoAccess>Only coaches can manage availability.</NoAccess>
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

  // Session length (migration 0283). Until it is applied the select errors and the setting is simply hidden.
  const sessionResult = await supabase.from("coach_availability_windows").select("id, session_minutes").eq("coach_id", user.id);
  const sessionLengthEnabled = !sessionResult.error;
  const sessionById = new Map(((sessionResult.data ?? []) as { id: string; session_minutes: number | null }[]).map((r) => [r.id, r.session_minutes]));

  // Session type on a window (migration 0289). Until it is applied the select errors and the type choice is simply hidden.
  const typeResult = await supabase.from("coach_availability_windows").select("id, session_type_id").eq("coach_id", user.id);
  const sessionTypeEnabled = !typeResult.error;
  const typeById = new Map(((typeResult.data ?? []) as { id: string; session_type_id: string | null }[]).map((r) => [r.id, r.session_type_id]));
  const { data: typeRows } = await supabase.from("session_types").select("id, name").eq("coach_id", user.id).order("created_at", { ascending: true });

  const windows = (windowRows ?? []).map((w) => ({
    id: w.id,
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
    sessionMinutes: sessionById.get(w.id) ?? null,
    sessionTypeId: typeById.get(w.id) ?? null,
  }));

  const { data: policyRow } = await supabase
    .from("coach_booking_policies")
    .select("cancellation_window_hours, buffer_minutes, minimum_notice_hours, credit_expiry_days")
    .eq("coach_id", user.id)
    .maybeSingle();

  // Re-up reminders switch (migration 0260). If the column is not there yet the select errors and the switch is simply hidden.
  const nudgeResult = await supabase.from("coach_booking_policies").select("reup_nudges_enabled").eq("coach_id", user.id).maybeSingle();
  const reupNudgesEnabled: boolean | null = nudgeResult.error ? null : (nudgeResult.data?.reup_nudges_enabled ?? true);

  // Heads-up days before sessions expire (migration 0280). Until it is applied the select errors and the setting is simply hidden.
  const headsUpResult = await supabase.from("coach_booking_policies").select("expiry_heads_up_days").eq("coach_id", user.id).maybeSingle();
  const expiryHeadsUpDays: number | null = headsUpResult.error ? null : ((headsUpResult.data?.expiry_heads_up_days as number | null) ?? 30);

  // How clients book (migration 0278). Until it is applied the select errors and the setting is simply hidden.
  const bookingModeResult = await supabase.from("coach_booking_policies").select("booking_mode").eq("coach_id", user.id).maybeSingle();
  const bookingMode: BookingMode | null = bookingModeResult.error ? null : ((bookingModeResult.data?.booking_mode as BookingMode | null) ?? "coach_schedules");

  const { data: exceptionRows } = await supabase
    .from("coach_availability_exceptions")
    .select("id, kind, label, start_at, end_at, weekday, start_time, end_time")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: false });

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

      {!coachProfile?.timezone && (
        <p className="font-body text-sm text-rust border border-rust/40 bg-rust/5 p-3 mb-4 max-w-md" role="status">
          Set your time zone below. Until you do, clients cannot send you a booking request, and your hours are read in Eastern time.
        </p>
      )}
      <TimezoneControl initialTimezone={coachProfile?.timezone ?? null} />

      <BookingPolicyControl
        key={`policy-${policyRow?.buffer_minutes ?? 0}`}
        coachId={user.id}
        initialCancellationHours={policyRow?.cancellation_window_hours ?? 24}
        initialBufferMinutes={policyRow?.buffer_minutes ?? 0}
        initialMinimumNoticeHours={policyRow?.minimum_notice_hours ?? 0}
        initialCreditExpiryDays={policyRow?.credit_expiry_days ?? 0}
      />

      {expiryHeadsUpDays !== null && <ExpiryHeadsUpControl coachId={user.id} initialDays={expiryHeadsUpDays} />}

      {bookingMode !== null && <BookingModeSelect coachId={user.id} initialMode={bookingMode} />}

      {reupNudgesEnabled !== null && <ReupNudgeToggle coachId={user.id} initialEnabled={reupNudgesEnabled} />}

      <AvailabilityExceptionsManager coachId={user.id} initialExceptions={exceptions} timezone={coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE} />

      <AvailabilityManagerDesktop coachId={user.id} initialWindows={windows} sessionLengthEnabled={sessionLengthEnabled} initialBufferMinutes={policyRow?.buffer_minutes ?? 0} sessionTypes={(typeRows ?? []) as { id: string; name: string }[]} sessionTypeEnabled={sessionTypeEnabled} />

    </CoachDesktopShell>
  );
}
