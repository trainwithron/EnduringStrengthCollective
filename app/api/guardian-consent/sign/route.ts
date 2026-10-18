import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { sendPushToProfile } from "@/lib/send-push";
import { appOrigin } from "@/lib/app-url";
import { GUARDIAN_PACKET_VERSION, checkSignature, guardianPacketText, majorityAgeFor } from "@/lib/guardian-consent";
import { coachNameFor, hashToken } from "@/lib/guardian-consent-server";

// A parent or guardian signs from the private link in their own inbox. No account: the one-time link is the credential, so the row is found by the hash of the link, must still be waiting and unexpired, and can be
// signed only once. What is recorded is the exact words they were shown (and their SHA-256 and version), their name, relationship and state, the time, and the address and device they signed from; a copy is emailed
// to them with a link to withdraw. The child's own click is never the consent.
export async function POST(request: Request) {
  const ip = clientIp(request);
  const byIp = await rateLimitResponse("guardian-sign-ip", ip, 30, 3600);
  if (byIp) return byIp;

  const body = (await request.json().catch(() => ({}))) as { token?: unknown; name?: unknown; relationship?: unknown; state?: unknown; understood?: unknown; mayRefuse?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  if (token.length < 20 || token.length > 100) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const byToken = await rateLimitResponse("guardian-sign-token", hashToken(token).slice(0, 16), 15, 3600);
  if (byToken) return byToken;

  const fields = {
    name: typeof body.name === "string" ? body.name.trim().slice(0, 120) : "",
    relationship: typeof body.relationship === "string" ? body.relationship : "",
    state: typeof body.state === "string" ? body.state : "",
    understood: body.understood === true,
    mayRefuse: body.mayRefuse === true,
  };
  const problem = checkSignature(fields);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: row } = await db.from("guardian_consents").select("id, athlete_id, guardian_email, status, expires_at").eq("token_hash", hashToken(token)).maybeSingle();
  const found = row as { id: string; athlete_id: string; guardian_email: string; status: string; expires_at: string } | null;
  if (!found) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  if (found.status === "signed") return NextResponse.json({ error: "This has already been signed." }, { status: 409 });
  if (found.status !== "pending" || new Date(found.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This link has expired or was replaced by a newer one. Ask the family member who asked you to send a new request." }, { status: 410 });
  }

  const [{ data: profile }, coach] = await Promise.all([db.from("profiles").select("full_name").eq("id", found.athlete_id).maybeSingle(), coachNameFor(db, found.athlete_id)]);
  const childName = (profile as { full_name?: string | null } | null)?.full_name?.trim() || "your child";
  const text = guardianPacketText({ athleteName: childName, coachName: coach, state: fields.state });
  const sha = createHash("sha256").update(text).digest("hex");
  const signedAt = new Date().toISOString();

  // Signed only if it is STILL waiting (two taps at once sign once).
  const { data: signed, error } = await db
    .from("guardian_consents")
    .update({
      status: "signed",
      guardian_name: fields.name,
      relationship: fields.relationship,
      residence_state: fields.state,
      majority_age: majorityAgeFor(fields.state),
      doc_version: GUARDIAN_PACKET_VERSION,
      doc_sha256: sha,
      doc_text: text,
      signed_at: signedAt,
      signed_ip: ip,
      signed_user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    })
    .eq("id", found.id)
    .eq("status", "pending")
    .select("id");
  if (error) return NextResponse.json({ error: "Couldn't record that. Try again." }, { status: 502 });
  if (!signed || signed.length === 0) return NextResponse.json({ error: "This has already been signed." }, { status: 409 });

  // A copy for the guardian, with how to withdraw. If it cannot be sent the signature stands and the page says so.
  const withdrawLink = `${appOrigin(request)}/guardian-consent/${token}`;
  const emailed = await sendEmail(
    found.guardian_email,
    `Your copy: permission for ${childName} to train`,
    `${text}

----------------------------------------
SIGNED by ${fields.name} (${fields.relationship}), living in ${fields.state}, on ${signedAt}.
Version ${GUARDIAN_PACKET_VERSION}. Fingerprint of these exact words: ${sha}.

You can take back your permission at any time. Open this link and choose "Withdraw my permission":
${withdrawLink}

Spotlight Coaching`
  );
  if (emailed) await db.from("guardian_consents").update({ copy_emailed_at: new Date().toISOString() }).eq("id", found.id);

  // Tell the child and their coaches (a push; best effort).
  try {
    const { data: seats } = await db.from("group_memberships").select("group_id").eq("profile_id", found.athlete_id).eq("role", "athlete");
    const groupIds = (seats ?? []).map((s: { group_id: string }) => s.group_id);
    const { data: coaches } = groupIds.length ? await db.from("group_memberships").select("profile_id, group_id").in("group_id", groupIds).eq("role", "coach") : { data: [] };
    await sendPushToProfile(db, found.athlete_id, "Permission received", "Your parent or guardian said yes. You can start.", "/").catch(() => 0);
    for (const c of (coaches ?? []) as { profile_id: string; group_id: string }[]) {
      await sendPushToProfile(db, c.profile_id, "Guardian permission received", `${childName}'s parent or guardian signed.`, `/groups/${c.group_id}/athletes/${found.athlete_id}`).catch(() => 0);
    }
  } catch {
    // The signature is what matters; the notices are a courtesy.
  }

  return NextResponse.json({ ok: true, text, emailedCopy: emailed, signedAt });
}
