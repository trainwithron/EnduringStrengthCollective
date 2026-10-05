import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadUnclaimedClient } from "@/lib/client-claim-server";

// Before a client has signed in, the coach can set or correct the email on
// their account (a typo, or no email yet). After they claim it, it's theirs.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, athleteId, email } = await request.json();
  const trimmed = typeof email === "string" ? email.trim() : "";
  if (!groupId || !athleteId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const client = await loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId);
  if (!client.ok) return NextResponse.json({ error: client.error }, { status: client.status });

  const { error } = await serviceRole.auth.admin.updateUserById(athleteId, { email: trimmed, email_confirm: true });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      return NextResponse.json({ error: "That email already has an account." }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't update the email — try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, email: trimmed });
}
