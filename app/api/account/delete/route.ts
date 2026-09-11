import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Detach (not delete) the tables that are really the COACH's record —
// logged-workout history, revenue audit trail, private notes — before
// the hard delete cascades through everything that's genuinely the
// athlete's own data. See 0118_athlete_deletion_detach.sql.
const DETACH_TABLES = ["workout_logs", "athlete_sessions", "credit_purchases", "athlete_notes"] as const;

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const userId = user.id;
  const serviceRole = createServiceRoleClient();

  for (const table of DETACH_TABLES) {
    const { error } = await serviceRole.from(table).update({ athlete_id: null }).eq("athlete_id", userId);
    if (error) {
      return NextResponse.json({ error: `Couldn't preserve your coach's records: ${error.message}` }, { status: 502 });
    }
  }

  const { error: deleteError } = await serviceRole.auth.admin.deleteUser(userId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
