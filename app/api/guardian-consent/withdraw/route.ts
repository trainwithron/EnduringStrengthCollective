import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { sendPushToProfile } from "@/lib/send-push";
import { hashToken } from "@/lib/guardian-consent-server";

// The guardian takes back their permission from the same private link. From that moment the client is stopped at the permission screen again (the gate looks at this every time for someone under 18). The signed
// record is kept (marked withdrawn, with the time); nothing is deleted.
export async function POST(request: Request) {
  const byIp = await rateLimitResponse("guardian-withdraw-ip", clientIp(request), 20, 3600);
  if (byIp) return byIp;

  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  if (token.length < 20 || token.length > 100) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });

  const db = createServiceRoleClient();
  const { data: updated, error } = await db
    .from("guardian_consents")
    .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .eq("status", "signed")
    .select("athlete_id, guardian_email");
  if (error) return NextResponse.json({ error: "Couldn't do that. Try again." }, { status: 502 });
  const row = (updated ?? [])[0] as { athlete_id: string; guardian_email: string } | undefined;
  if (!row) return NextResponse.json({ error: "There is no permission on file for this link." }, { status: 404 });

  const { data: profile } = await db.from("profiles").select("full_name").eq("id", row.athlete_id).maybeSingle();
  const childName = (profile as { full_name?: string | null } | null)?.full_name?.trim() || "your child";
  await sendEmail(row.guardian_email, `Permission withdrawn for ${childName}`, `You took back your permission for ${childName} to train with Spotlight Coaching. They can't use the app until a parent or guardian gives permission again.\n\nSpotlight Coaching`).catch(() => false);

  try {
    const { data: seats } = await db.from("group_memberships").select("group_id").eq("profile_id", row.athlete_id).eq("role", "athlete");
    const groupIds = (seats ?? []).map((s: { group_id: string }) => s.group_id);
    const { data: coaches } = groupIds.length ? await db.from("group_memberships").select("profile_id, group_id").in("group_id", groupIds).eq("role", "coach") : { data: [] };
    for (const c of (coaches ?? []) as { profile_id: string; group_id: string }[]) {
      await sendPushToProfile(db, c.profile_id, "Guardian permission withdrawn", `${childName}'s parent or guardian took back their permission.`, `/groups/${c.group_id}/athletes/${row.athlete_id}`).catch(() => 0);
    }
  } catch {
    // courtesy only
  }
  return NextResponse.json({ ok: true });
}
