import { chooseReupPackage, formatPackagePrice, type ReupPackageOption } from "@/lib/reup";
import { isStripeConfigured } from "@/lib/stripe";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";

// What a client sees when their sessions have run out: the one-tap re-up (the package they bought last, else the one their
// coach assigned) and, when a session is booked soon, a "this session needs a re-up" prompt. Returns null while they still
// have sessions or have never been put on sessions. Wording stays neutral: never "you owe". Runs as the client, so it only
// reads what their own policies already allow; anything it cannot read just means "no package found".
export interface ReupState {
  groupId: string;
  package: { id: string; name: string; priceLabel: string; sessions: number; recurring: boolean } | null;
  // True when payments are switched on for the platform. Otherwise the client is told to message their coach.
  canPay: boolean;
  // A confirmed session in the next day, in the coach's time zone, e.g. "today at 6:00 AM".
  nextSessionLabel: string | null;
}

export async function loadReupState(supabase: any, athleteId: string, groupId: string): Promise<ReupState | null> {
  // A client the coach has put on hold (comped, on a break, billed another way, such as through Acuity) never sees a re-up prompt. If the hold
  // column is not there yet (migration 0260), fall back to reading the balance alone.
  const { data: firstTry, error: creditsError } = await supabase.from("session_credits").select("balance, payment_hold").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
  const credits = creditsError
    ? (await supabase.from("session_credits").select("balance").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle()).data
    : firstTry;
  if (!credits || credits.balance > 0 || credits.payment_hold === true) return null;

  const now = new Date();
  const [{ data: purchases }, { data: assigned }, tz, { data: nextBooking }] = await Promise.all([
    supabase.from("credit_purchases").select("coach_package_id").eq("athlete_id", athleteId).eq("group_id", groupId).not("coach_package_id", "is", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("package_assignments").select("coach_package_id").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(5),
    getGroupCoachTimezone(supabase, groupId),
    supabase
      .from("bookings")
      .select("start_at")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      .gte("start_at", new Date(now.getTime() - 2 * 3600000).toISOString())
      .lte("start_at", new Date(now.getTime() + 24 * 3600000).toISOString())
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const purchasedIds = ((purchases ?? []) as { coach_package_id: string }[]).map((p) => p.coach_package_id);
  const assignedIds = ((assigned ?? []) as { coach_package_id: string }[]).map((p) => p.coach_package_id);
  const candidateIds = [...new Set([...purchasedIds, ...assignedIds])];

  let chosen: ReupPackageOption | null = null;
  if (candidateIds.length > 0) {
    const { data: pkgRows } = await supabase
      .from("coach_packages")
      .select("id, name, rate_cents, sessions_granted, billing_type, is_active")
      .in("id", candidateIds);
    const options: ReupPackageOption[] = ((pkgRows ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      priceCents: r.rate_cents * r.sessions_granted,
      sessionsGranted: r.sessions_granted,
      billingType: r.billing_type,
      isActive: r.is_active,
    }));
    chosen = chooseReupPackage(purchasedIds, assignedIds, options);
  }

  let nextSessionLabel: string | null = null;
  if (nextBooking?.start_at) {
    const start = new Date(nextBooking.start_at);
    const sameDay = dateKeyInZone(tz, start) === dateKeyInZone(tz, now);
    const time = formatInTimezone(start, tz, "time");
    nextSessionLabel = sameDay ? `today at ${time}` : `${formatInTimezone(start, tz, "date")} at ${time}`;
  }

  return {
    groupId,
    package: chosen
      ? {
          id: chosen.id,
          name: chosen.name,
          priceLabel: formatPackagePrice(chosen.priceCents),
          sessions: chosen.sessionsGranted,
          recurring: chosen.billingType === "subscription",
        }
      : null,
    canPay: isStripeConfigured(),
    nextSessionLabel,
  };
}
