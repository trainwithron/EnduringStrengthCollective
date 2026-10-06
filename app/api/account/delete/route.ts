import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deletionBlocker, eraseAccount, loadDeletionFacts } from "@/lib/account-deletion";

// A client deletes their own account. Their logged workouts, the coach's notes and payment records stay with the coach, no
// longer linked to them; everything else that is theirs is erased. See lib/account-deletion.ts and
// 0118_athlete_deletion_detach.sql.
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const serviceRole = createServiceRoleClient();
  const blocker = deletionBlocker(await loadDeletionFacts(serviceRole, user.id));
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  const result = await eraseAccount(serviceRole, user.id, { eraseHistory: false });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ success: true });
}
