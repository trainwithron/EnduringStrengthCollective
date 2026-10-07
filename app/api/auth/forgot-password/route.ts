import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/app-url";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";

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

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: `${appOrigin(request)}/set-password` });
  if (error) {
    if (/rate limit|too many|seconds/i.test(error.message)) {
      return NextResponse.json({ error: "We couldn't send the email right now because too many were sent recently. Try again in a few minutes." }, { status: 429 });
    }
    // Anything else (no such account, not confirmed) is answered like success.
    if (!/fetch|network|timeout/i.test(error.message)) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: "We couldn't send the email. Try again in a few minutes." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
