import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/app-url";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";

// Sends the signup confirmation email again. Public (the person cannot sign in yet), so it is rate limited per address
// and per email, and it always answers the same way for an unknown or already-confirmed email so it cannot be used to find
// out which emails have accounts. A real failure to send (for example the mail service's hourly limit) IS reported, so the
// person is not left waiting for an email that is not coming.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const ip = clientIp(request);
  if (!(await rateLimitAllows(`resend-confirm-ip:${ip}`, 10, 3600)) || !(await rateLimitAllows(`resend-confirm:${email}`, 3, 3600))) {
    return NextResponse.json({ error: "Too many requests. Wait a few minutes and try again." }, { status: 429 });
  }

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${appOrigin(request)}/confirm-email` },
  });
  if (error) {
    if (/rate limit|too many|seconds/i.test(error.message)) {
      return NextResponse.json(
        { error: "We couldn't send the email right now because too many were sent recently. Try again in a few minutes." },
        { status: 429 }
      );
    }
    // Already confirmed or no such account: do not say which.
    if (/already|confirmed|not found|no user/i.test(error.message)) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: "We couldn't send the email. Try again in a few minutes." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
