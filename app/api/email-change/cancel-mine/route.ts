import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { cancelPendingForProfile } from "@/lib/email-change";

// The signed-in person says no to a sign-in email change that is waiting on their own account. Only ever their own: the person is the session, never read from the request.
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const result = await cancelPendingForProfile(createServiceRoleClient(), user.id);
  return NextResponse.json({ ok: result.ok, cancelled: result.cancelled });
}
