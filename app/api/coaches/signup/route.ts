import { NextResponse } from "next/server";
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

  const { data: created, error: createError } = await serviceRole.auth.admin.createUser({
    email: trimmedEmail,
    password: pw,
    email_confirm: true,
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
    return NextResponse.json({ groupId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't set up your organization." },
      { status: 502 }
    );
  }
}
