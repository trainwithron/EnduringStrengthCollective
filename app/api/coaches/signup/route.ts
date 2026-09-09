import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createOrganization } from "@/lib/org-creation";

// Self-service coach signup — a brand-new person, no pre-existing
// invite/relationship, creating their own account AND their own
// organization in one step. Everything runs through the service-role
// client (same reasoning as the client/coach invite routes: there is no
// session yet to check RLS against), so this route's only real
// authorization boundary is picking a genuinely available email and a
// real password — both supplied directly by the person creating their
// own account, the same way any signup form on any site works.
//
// The account is created *unconfirmed* (email_confirm: false) — this
// used to be forced to true, which meant anyone could sign up with an
// email address they don't actually control and get a fully active
// coach account + organization with zero proof they ever received it.
// admin.createUser() doesn't send a confirmation email itself (it's
// meant for backend-created accounts), so a separate resend() call
// below triggers Supabase's own built-in "Confirm signup" email — the
// same mailer that already reliably delivers the client/coach invite
// emails elsewhere in this app, no new email infrastructure needed.
export async function POST(request: Request) {
  const { fullName, orgName, email, password } = await request.json();
  const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
  const trimmedOrgName = typeof orgName === "string" ? orgName.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const pw = typeof password === "string" ? password : "";

  if (!trimmedName || !trimmedOrgName || !trimmedEmail) {
    return NextResponse.json({ error: "Missing name, organization name, or email." }, { status: 400 });
  }
  if (pw.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  const { data: created, error: createError } = await serviceRole.auth.admin.createUser({
    email: trimmedEmail,
    password: pw,
    email_confirm: false,
    user_metadata: { full_name: trimmedName },
  });

  if (createError || !created?.user) {
    const message = createError?.message ?? "Couldn't create your account.";
    const isDuplicate = /already registered|already exists|already been registered/i.test(message);
    return NextResponse.json(
      { error: isDuplicate ? "That email is already registered to an account." : message },
      { status: isDuplicate ? 409 : 502 }
    );
  }

  const newUserId = created.user.id;

  const { error: profileError } = await serviceRole
    .from("profiles")
    .insert({ id: newUserId, full_name: trimmedName });
  if (profileError) {
    return NextResponse.json({ error: `Couldn't create your profile: ${profileError.message}` }, { status: 502 });
  }

  try {
    const { groupId } = await createOrganization(serviceRole, {
      name: trimmedOrgName,
      starterGroupName: "Main Group",
      ownerId: newUserId,
    });

    // Best-effort — the account and organization already exist either
    // way, so a delivery hiccup here shouldn't turn into a failed signup;
    // logged server-side rather than surfaced, same tolerance as other
    // non-critical side effects in this app.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error: resendError } = await anon.auth.resend({
      type: "signup",
      email: trimmedEmail,
      options: { emailRedirectTo: `${origin}/confirm-email` },
    });
    if (resendError) console.error("Couldn't send signup confirmation email:", resendError.message);

    return NextResponse.json({ groupId, pendingConfirmation: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't set up your organization." },
      { status: 502 }
    );
  }
}
