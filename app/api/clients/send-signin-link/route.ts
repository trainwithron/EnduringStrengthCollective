import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { appOrigin } from "@/lib/app-url";
import { isPlaceholderEmail } from "@/lib/client-claim";
import { maskEmail } from "@/lib/mask-email";
import { rateLimitAllows, rateLimitResponse } from "@/lib/rate-limit";

// A coach emails a client a link to set a new password and sign in ("I can't get in"). The email goes to the client's OWN address and the coach never sees the
// link, so this can never be used to sign in as the client (the coach-minted claim link is only for a client who has never signed in; see /api/clients/invite-link).
// Only that client's coach, only for a real address, and rate limited. The coach is told where it went, with the address partly hidden.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("send-signin-link", user.id, 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing groupId or athleteId." }, { status: 400 });

  const { data: caller } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (caller?.role !== "coach") return NextResponse.json({ error: "Only this client's coach can do that." }, { status: 403 });

  const serviceRole = createServiceRoleClient();
  const { data: member } = await serviceRole.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (member?.role !== "athlete") return NextResponse.json({ error: "Client not found in this group." }, { status: 404 });

  if (!(await rateLimitAllows(`send-signin-link:${athleteId}`, 3, 3600))) {
    return NextResponse.json({ error: "A link was already sent a few times in the last hour. Ask them to check their inbox and spam." }, { status: 429 });
  }

  const { data: target } = await serviceRole.auth.admin.getUserById(athleteId);
  const email = target?.user?.email ?? null;
  if (!email || isPlaceholderEmail(email)) {
    return NextResponse.json({ error: "This client has no email address on file yet. Use the sign-in link on their profile instead." }, { status: 400 });
  }
  // Supabase sends nothing to an address it has not confirmed (and says nothing about it), so this must not claim a send.
  if (!target?.user?.email_confirmed_at) {
    return NextResponse.json({ error: "Their email address has not been confirmed yet, so no link can be sent. Use the sign-in link on their profile instead." }, { status: 400 });
  }
  // A sign-in link goes to whatever address is on the account. For a day after a coach changed that address it is not offered, so a changed email can never be
  // followed straight away by a link to the new inbox (the client is told in the app, and the old address when mail is on).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentChange } = await serviceRole.from("notifications").select("id").eq("profile_id", athleteId).eq("type", "email_changed").gte("created_at", since).limit(1);
  if ((recentChange ?? []).length > 0) {
    return NextResponse.json({ error: "Their sign-in email was changed in the last 24 hours, so a link can't be sent yet. Ask them to sign in with the new address or reset the password themselves." }, { status: 403 });
  }

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: `${appOrigin(request)}/set-password` });
  if (error) {
    // The mail service's own cooldown ("wait 60 seconds") means a link was just sent.
    const cooldown = /rate limit|too many|seconds/i.test(error.message);
    return NextResponse.json(
      { error: cooldown ? "A link was just sent. Wait a minute before sending another." : "The email couldn't be sent. Try again in a few minutes." },
      { status: cooldown ? 429 : 502 }
    );
  }
  return NextResponse.json({ ok: true, sentTo: maskEmail(email) });
}
