import { createServerClient } from "@/lib/supabase/server";
import { BookingPolicyControl } from "@/components/coach/desktop/booking-policy-control";
import { ReupNudgeToggle } from "@/components/coach/desktop/reup-nudge-toggle";
import { ExpiryHeadsUpControl } from "@/components/coach/desktop/expiry-heads-up-control";
import { BookingModeSelect, type BookingMode } from "@/components/coach/desktop/booking-mode-select";
import { AvailabilityExceptionsManager } from "@/components/coach/desktop/availability-exceptions-manager";
import { TimezoneControl } from "@/components/coach/desktop/timezone-control";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { ensureDefaultPublicPage } from "@/lib/default-public-page";
import { ConsultationLinkBlock } from "@/components/coach/desktop/consultation-link-block";
import { ShareCardSettings } from "@/components/coach/share-card-settings";
import { readShareCardSettings } from "@/lib/share-card-settings";
import { SessionLimitsControl } from "@/components/coach/desktop/session-limits-control";
import { limitsFromRow } from "@/lib/session-caps";

// ONE Availability place (Calendar > Availability): how clients book first, then the booking rules, then the time zone; below the recurring hours come the time-off blocks. These used to live on a second page,
// /groups/<id>/availability, which now sends the coach here. Each read that depends on a later database update hides its control until the column exists, as before.
export async function AvailabilityBookingSettings({ coachId }: { coachId: string }) {
  const supabase = await createServerClient();
  const [{ data: coachProfile, error: profileError }, { data: policyRow, error: policyError }, nudgeResult, headsUpResult, bookingModeResult, limitsResult] = await Promise.all([
    supabase.from("profiles").select("timezone, full_name").eq("id", coachId).maybeSingle(),
    supabase.from("coach_booking_policies").select("cancellation_window_hours, buffer_minutes, minimum_notice_hours, credit_expiry_days").eq("coach_id", coachId).maybeSingle(),
    supabase.from("coach_booking_policies").select("reup_nudges_enabled").eq("coach_id", coachId).maybeSingle(),
    supabase.from("coach_booking_policies").select("expiry_heads_up_days").eq("coach_id", coachId).maybeSingle(),
    supabase.from("coach_booking_policies").select("booking_mode").eq("coach_id", coachId).maybeSingle(),
    // Session caps, keep-together and lunch (0432): hidden until the columns exist.
    supabase.from("coach_booking_policies").select("max_sessions_per_week, max_sessions_per_month, keep_together, lunch_start, lunch_end").eq("coach_id", coachId).maybeSingle(),
  ]);
  // A failed read must not show default settings as if they were the coach's own (the next edit would save those defaults over the real ones).
  if (profileError || policyError) {
    return (
      <p className="font-body text-sm text-rust mb-6" role="alert">
        Couldn&apos;t load your booking settings. Refresh the page to try again.
      </p>
    );
  }
  const reupNudgesEnabled: boolean | null = nudgeResult.error ? null : (nudgeResult.data?.reup_nudges_enabled ?? true);
  const expiryHeadsUpDays: number | null = headsUpResult.error ? null : ((headsUpResult.data?.expiry_heads_up_days as number | null) ?? 30);
  // A coach who never chose is shown the real default, "I schedule everyone", selected.
  const bookingMode: BookingMode | null = bookingModeResult.error ? null : ((bookingModeResult.data?.booking_mode as BookingMode | null) ?? "coach_schedules");

  // Every coach has a public page: made here, once, the first time this screen opens (no address to pick, nothing to set up). A database without the booking-page tables yet simply shows no block.
  const publicPage = await ensureDefaultPublicPage(supabase, coachId, (coachProfile as { full_name?: string | null } | null)?.full_name);
  const { count: openWindowCount } = await supabase.from("coach_availability_windows").select("id", { count: "exact", head: true }).eq("coach_id", coachId);
  // The Instagram handle and the QR switch for clients' share pictures, with the public page they belong to (the phone reaches its public page settings here).
  const shareCard = publicPage ? await readShareCardSettings(supabase, coachId) : null;

  return (
    <div>
      {bookingMode !== null && <BookingModeSelect coachId={coachId} initialMode={bookingMode} />}
      {!limitsResult.error && <SessionLimitsControl coachId={coachId} initial={limitsFromRow(limitsResult.data as Record<string, unknown> | null)} />}
      {publicPage && <ConsultationLinkBlock coachId={coachId} slug={publicPage.slug} enabled={publicPage.enabled} acceptsRequests={publicPage.acceptsRequests} hasOpenHours={(openWindowCount ?? 0) > 0} />}
      {shareCard && <ShareCardSettings coachId={coachId} initialHandle={shareCard.handle} initialQr={shareCard.qr} />}

      <section className="mb-6" aria-labelledby="booking-rules">
        <h2 id="booking-rules" className="font-display uppercase text-lg tracking-wide mb-2">
          Booking rules
        </h2>
        <BookingPolicyControl
          key={`policy-${policyRow?.buffer_minutes ?? 0}`}
          coachId={coachId}
          initialCancellationHours={policyRow?.cancellation_window_hours ?? 24}
          initialBufferMinutes={policyRow?.buffer_minutes ?? 0}
          initialMinimumNoticeHours={policyRow?.minimum_notice_hours ?? 0}
          initialCreditExpiryDays={policyRow?.credit_expiry_days ?? 0}
        />
        {expiryHeadsUpDays !== null && <ExpiryHeadsUpControl coachId={coachId} initialDays={expiryHeadsUpDays} />}
        {reupNudgesEnabled !== null && <ReupNudgeToggle coachId={coachId} initialEnabled={reupNudgesEnabled} />}
      </section>

      {!coachProfile?.timezone && (
        <p className="font-body text-sm text-rust border border-rust/40 bg-rust/5 p-3 mb-4 max-w-md" role="status">
          Set your time zone below. Until you do, clients cannot send you a booking request, and your hours are read in Eastern time.
        </p>
      )}
      <TimezoneControl initialTimezone={coachProfile?.timezone ?? null} />
    </div>
  );
}

export async function AvailabilityTimeOff({ coachId }: { coachId: string }) {
  const supabase = await createServerClient();
  const [{ data: coachProfile }, { data: exceptionRows, error: exceptionsError }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", coachId).maybeSingle(),
    supabase.from("coach_availability_exceptions").select("id, kind, label, start_at, end_at, weekday, start_time, end_time").eq("coach_id", coachId).order("created_at", { ascending: false }),
  ]);
  if (exceptionsError) {
    return (
      <p className="font-body text-sm text-rust mt-6" role="alert">
        Couldn&apos;t load your time off. Refresh the page to try again.
      </p>
    );
  }
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
  return <AvailabilityExceptionsManager coachId={coachId} initialExceptions={exceptions} timezone={coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE} />;
}
