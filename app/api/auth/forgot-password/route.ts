import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/app-url";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";
import { isEmailConfigured } from "@/lib/email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { makeAuthLink, recoveryEmail, sendAuthMail } from "@/lib/auth-mail";

// Sends the "reset your password" email. It is sent from the SERVER (not the browser library) so the link carries the session in the address and works on any
// device: a link made by the browser library only works in the browser that asked, so a reset asked for on a computer and opened on a phone said "invalid or
// expired". Public (the person cannot sign in), rate limited per address and per email, and it answers the same way for an unknown email so it cannot be used to
// find out which emails have accounts. /set-password reads the link (lib/auth-link.ts).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const ip = clientIp(request);
  if (!(await rateLimitAllows(`forgot-password-ip:${ip}`, 10, 3600)) || !(await rateLimitAllows(`forgot-password:${email}`, 3, 3600))) {
    return NextResponse.json({ error: "Too many requests. Wait a few minutes and try again." }, { status: 429 });
  }

  // With the transactional mail service set up, the email is sent by us (a link made by the auth service, delivered by Brevo), so it does not depend on the auth service's own mailer. Whatever happens, the answer is the
  // same "ok" for an address that has an account and one that does not. Without the mail service the older route below is used.
  if (isEmailConfigured()) {
    const db = createServiceRoleClient();
    const made = await makeAuthLink(db, { type: "recovery", email, redirectTo: `${appOrigin(request)}/set-password` });
    if (made.link) {
      const sent = await sendAuthMail(email, recoveryEmail({ toName: null, link: made.link }));
      if (!sent) console.error("[forgot-password] the reset email could not be sent through the mail service");
    }
    return NextResponse.json({ ok: true });
  }

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: `${appOrigin(request)}/set-password` });
  if (error) {
    // Supabase's own "wait 60 seconds" and "too many emails" answers only appear for an address that exists, so they are NOT shown (that would tell a real account
    // from a fake one). Our own limits above (per address and per email) are the only 429s. Only a failure to reach the mail service at all is reported.
    if (/fetch|network|timeout/i.test(error.message)) return NextResponse.json({ error: "We couldn't send the email. Try again in a few minutes." }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true });
}
