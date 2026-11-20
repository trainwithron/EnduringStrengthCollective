import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hasLiveClaimLink, loadUnclaimedClient } from "@/lib/client-claim-server";
import { isPlaceholderEmail } from "@/lib/client-claim";
import { sendClaimEmail } from "@/lib/claim-email-send";
import { appOrigin } from "@/lib/app-url";
import { isEmailConfigured } from "@/lib/email";
import { rateLimitAllows, rateLimitResponse } from "@/lib/rate-limit";

// A coach emails a client who has never signed in their sign-in (claim) link. It goes ONLY to the address already on the client's account, never to a
// typed-in address, and only from that client's coach. A new link replaces any earlier one, so if one still works the coach must confirm first
// (confirmReplace). If the email can't be sent the link is handed back so the coach can copy or text it instead.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("email-claim-link", user.id, 30, 3600);
  if (limited) return limited;
  // The platform's own sender is used, so there is also a daily ceiling per coach.
  const limitedDay = await rateLimitResponse("email-claim-link-day", user.id, 60, 86400);
  if (limitedDay) return limitedDay;

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing groupId or athleteId." }, { status: 400 });

  const serviceRole = createServiceRoleClient();
  const client = await loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId);
  if (!client.ok) return NextResponse.json({ error: client.error }, { status: client.status });

  const { data: target } = await serviceRole.auth.admin.getUserById(athleteId);
  const email = target?.user?.email ?? null;
  if (!email || isPlaceholderEmail(email)) {
    return NextResponse.json({ error: "This client has no email address on file yet. Add one first." }, { status: 400 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email sending isn't set up yet. Copy the link or text it instead.", notConfigured: true }, { status: 503 });
  }

  if (!(await rateLimitAllows(`email-claim-link:${athleteId}`, 5, 24 * 3600))) {
    return NextResponse.json({ error: "Already emailed 5 times today. Ask them to check their inbox and spam, or text the link." }, { status: 429 });
  }

  if (body.confirmReplace !== true && (await hasLiveClaimLink(serviceRole, athleteId))) {
    return NextResponse.json({ needsConfirm: true }, { status: 409 });
  }

  // The same email the "email everyone not signed in yet" button sends (lib/claim-email-send.ts): the coach's own wording if they wrote one.
  const sent = await sendClaimEmail(serviceRole, { coachId: user.id, athleteId, fullName: client.fullName, email, origin: appOrigin(request) });
  if (!sent.ok && !sent.link) return NextResponse.json({ error: "Couldn't create the link — try again." }, { status: 500 });
  if (!sent.ok) {
    return NextResponse.json(
      { error: "The email couldn't be sent. Here is the link to copy or text instead.", link: sent.link },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, sentTo: email, expiresAt: sent.expiresAt });
}
