import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { limitByIp } from "@/lib/public-booking-route";
import { isRealCalendarDate, requestTargetFor } from "@/lib/client-requests";
import { friendlySignUpError } from "@/lib/sign-in-errors";

// A visitor on a coach's "Request to train" page makes an account AND sends the request in one go (Ron, Oct 31: a new client at the gym could not find the
// confirmation email, so the request was never sent and the coach never heard). The coach is told at once; their list says the email is not confirmed yet, and the
// person signs in after confirming it. The account is made here, so the request can only ever be for the account made in this same call (the database function
// also takes only an account made minutes ago that nobody has signed in to). The body is { slug, name, email, password, dob }.
export async function POST(request: Request) {
  const limited = await limitByIp(request, "client-request-signup-ip", 10, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const slug = typeof raw?.slug === "string" ? raw.slug : "";
  const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 120) : "";
  const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
  const password = typeof raw?.password === "string" ? raw.password : "";
  const dob = typeof raw?.dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.dob) ? raw.dob : null;
  if (!name) return NextResponse.json({ error: "Enter your name.", code: "name_needed" }, { status: 400 });
  if (!email || !password) return NextResponse.json({ error: "Enter your email and a password.", code: "signup_failed" }, { status: 400 });
  if (!dob) return NextResponse.json({ error: "Please enter your date of birth.", code: "dob_needed" }, { status: 400 });
  if (!isRealCalendarDate(dob)) return NextResponse.json({ error: "That date of birth is not a real date.", code: "dob_invalid" }, { status: 400 });

  const service = createServiceRoleClient();
  const target = await requestTargetFor(service, slug);
  if (!target) return NextResponse.json({ error: "This coach isn't taking requests through this page.", code: "not_taking" }, { status: 404 });

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: `${new URL(request.url).origin}/c/${target.slug}/request` },
  });
  if (error) {
    const hasAccount = /already registered|already exists/i.test(error.message);
    return NextResponse.json({ error: friendlySignUpError(error.message), code: hasAccount ? "has_account" : "signup_failed" }, { status: hasAccount ? 409 : 400 });
  }
  // An email that already has an account comes back as a user with no sign-in methods (the service does not say so outright).
  const user = data.user;
  if (!user || (user.identities?.length ?? 0) === 0) {
    return NextResponse.json({ error: "That email already has an account. Tap 'I have an account' to sign in.", code: "has_account" }, { status: 409 });
  }

  let out: { ok?: boolean; id?: string; code?: string; message?: string } | null;
  if (data.session) {
    // Signed in straight away (only when email confirmation is switched off): the usual signed-in path, after the profile row the coach's list needs.
    await service.from("profiles").upsert({ id: user.id, full_name: name }, { onConflict: "id", ignoreDuplicates: true });
    const res = await supabase.rpc("submit_client_request", { p_coach: target.coachId, p_dob: dob });
    out = res.error ? null : (res.data as typeof out);
  } else {
    const res = await service.rpc("submit_client_request_at_signup", { p_requester: user.id, p_coach: target.coachId, p_dob: dob });
    out = res.error ? null : (res.data as typeof out);
  }
  // The account is made either way; only the request can fail here, and the person can send it again after signing in.
  if (!out) return NextResponse.json({ error: "Your account was made, but the request didn't send. Confirm your email, sign in and send it again.", code: "failed", accountMade: true }, { status: 502 });
  if (out.ok !== true) {
    const code = out.code ?? "failed";
    return NextResponse.json({ error: out.message ?? "Couldn't send the request.", code, accountMade: true }, { status: code === "too_many" ? 429 : 409 });
  }
  return NextResponse.json({ ok: true, confirmed: !!data.session }, { headers: { "Cache-Control": "no-store" } });
}
