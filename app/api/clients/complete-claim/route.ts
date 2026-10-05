import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPlaceholderEmail } from "@/lib/client-claim";

// Called by the set-password page once a client has chosen their password:
// records that they've signed in (claimed_at) and, if their account still
// has the placeholder address the coach created it with, saves the real
// email they entered. Only ever acts on the signed-in person's OWN account.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const serviceRole = createServiceRoleClient();

  if (isPlaceholderEmail(user.email)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
    }
    const { error } = await serviceRole.auth.admin.updateUserById(user.id, { email, email_confirm: true });
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return NextResponse.json(
        { error: taken ? "That email already has an account." : "Couldn't save your email — try again." },
        { status: taken ? 409 : 500 }
      );
    }
  }

  await serviceRole
    .from("profiles")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("claimed_at", null);

  return NextResponse.json({ ok: true });
}
