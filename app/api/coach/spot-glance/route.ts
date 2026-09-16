import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { computeRealMRR } from "@/lib/business-metrics";

// the_spot_dropdown_widget_redesign_sept16.md — the Spot's top-anchored
// widget bar, generalized from components/coach/mobile/the-spot-rail.tsx
// (which is single-client-scoped, only ever rendered while impersonating
// one athlete) into a roster-wide glance available globally. Client-
// specific tiles (credits/waiver) are scoped to the one group this
// request names, matching CoachMobileShell's own per-group context;
// business tiles (MRR/support) are coach-wide, matching how the desktop
// Business dashboard already presents "your whole business" regardless
// of which group you're looking from.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "Missing groupId." }, { status: 400 });

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only coaches can view the Spot." }, { status: 403 });
  }

  const { data: group } = await supabase
    .from("groups")
    .select("organization_id")
    .eq("id", groupId)
    .maybeSingle();

  const { data: roster } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", groupId)
    .eq("role", "athlete");
  const athleteIds = (roster ?? []).map((r) => r.profile_id);
  const nameById = new Map((roster ?? []).map((r: any) => [r.profile_id, r.profiles?.full_name ?? "Client"]));

  const [
    { data: creditsRows },
    { data: subRows },
    { data: intakeRequiredRows },
    { data: intakeCompletedRows },
    { data: openRequests },
    { data: allSubsForMrr },
  ] = await Promise.all([
    athleteIds.length > 0
      ? supabase.from("session_credits").select("athlete_id, balance").eq("group_id", groupId).in("athlete_id", athleteIds)
      : Promise.resolve({ data: [] as { athlete_id: string; balance: number }[] }),
    athleteIds.length > 0
      ? supabase
          .from("membership_subscriptions")
          .select("athlete_id")
          .eq("group_id", groupId)
          .eq("status", "active")
          .in("athlete_id", athleteIds)
      : Promise.resolve({ data: [] as { athlete_id: string }[] }),
    athleteIds.length > 0
      ? supabase.from("profiles").select("id, intake_required").in("id", athleteIds).eq("intake_required", true)
      : Promise.resolve({ data: [] as { id: string; intake_required: boolean }[] }),
    athleteIds.length > 0
      ? supabase.from("client_intake").select("athlete_id, completed_at").in("athlete_id", athleteIds)
      : Promise.resolve({ data: [] as { athlete_id: string; completed_at: string | null }[] }),
    group?.organization_id
      ? supabase
          .from("support_requests")
          .select("id, subject, created_at")
          .eq("organization_id", group.organization_id)
          .eq("status", "open")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; subject: string; created_at: string }[] }),
    supabase.from("membership_subscriptions").select("price_cents, status").eq("status", "active"),
  ]);

  const subscribedIds = new Set((subRows ?? []).map((s) => s.athlete_id));
  const lowCreditsClients = (creditsRows ?? [])
    .filter((c) => c.balance <= 1 && !subscribedIds.has(c.athlete_id))
    .map((c) => ({ id: c.athlete_id, name: nameById.get(c.athlete_id) ?? "Client", balance: c.balance }));

  const completedByAthlete = new Map((intakeCompletedRows ?? []).map((r) => [r.athlete_id, !!r.completed_at]));
  const incompleteWaiverClients = (intakeRequiredRows ?? [])
    .filter((r) => !completedByAthlete.get(r.id))
    .map((r) => ({ id: r.id, name: nameById.get(r.id) ?? "Client" }));

  const mrr = computeRealMRR((allSubsForMrr ?? []).map((s) => ({ status: s.status as "active", priceCents: s.price_cents })));

  return NextResponse.json({
    lowCreditsClients,
    incompleteWaiverClients,
    support: { openCount: (openRequests ?? []).length, openRequests: (openRequests ?? []).map((r) => ({ id: r.id, subject: r.subject, createdAt: r.created_at })) },
    mrr,
  });
}
