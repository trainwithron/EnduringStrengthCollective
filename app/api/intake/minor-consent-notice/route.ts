import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consentNoticeBody, needsConsentNotice } from "@/lib/minor-consent-notice";
import { sendPushToProfile } from "@/lib/send-push";

// Called by the birthday step right after a child under 13 saves their date of birth: tells the coach of each group the child is in, once a week at most per coach, that parental consent is waiting.
// Everything is read here from the database (the caller can only ask about themselves); nothing is taken from the request.
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createServiceRoleClient();
  const [{ data: intake }, { data: profile }, { data: seats }] = await Promise.all([
    admin.from("client_intake").select("date_of_birth").eq("athlete_id", user.id).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    admin.from("group_memberships").select("group_id, role").eq("profile_id", user.id).eq("role", "athlete"),
  ]);
  const groupIds = (seats ?? []).map((s: { group_id: string }) => s.group_id);
  if (groupIds.length === 0) return NextResponse.json({ ok: true, notified: 0 });

  const { data: consents } = await admin.from("minor_consent").select("group_id, verified").eq("athlete_id", user.id).eq("verified", true);
  if (!needsConsentNotice({ dateOfBirth: (intake as { date_of_birth?: string | null } | null)?.date_of_birth ?? null, consentVerified: (consents ?? []).length > 0 && groupIds.every((g) => (consents ?? []).some((c: { group_id: string }) => c.group_id === g)) })) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  const { data: coachSeats } = await admin.from("group_memberships").select("profile_id, group_id").in("group_id", groupIds).eq("role", "coach");
  const body = consentNoticeBody((profile as { full_name?: string | null } | null)?.full_name ?? null);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  let notified = 0;
  for (const seat of (coachSeats ?? []) as { profile_id: string; group_id: string }[]) {
    const link = `/groups/${seat.group_id}/athletes/${user.id}`;
    const { data: recent } = await admin
      .from("notifications")
      .select("id")
      .eq("profile_id", seat.profile_id)
      .eq("type", "minor_consent_needed")
      .eq("link_path", link)
      .gt("created_at", weekAgo)
      .limit(1);
    if ((recent ?? []).length > 0) continue;
    const { error } = await admin.from("notifications").insert({ profile_id: seat.profile_id, group_id: seat.group_id, type: "minor_consent_needed", body, link_path: link });
    if (error) continue;
    notified++;
    await sendPushToProfile(admin, seat.profile_id, "Parental consent needed", body, link).catch(() => 0);
  }
  return NextResponse.json({ ok: true, notified });
}
