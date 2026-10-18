import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";

// A coach takes a client out of a group: "Remove from my clients" (kept, restorable) or "Delete permanently" (the same removal, with 30 days to undo before the account is erased). The rules are in the database
// function remove_client (migration 0407); it runs as the coach, so it refuses anyone who does not coach the group.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("client-remove", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing client." }, { status: 400 });

  const { data, error } = await supabase.rpc("remove_client", {
    p_group: groupId,
    p_athlete: athleteId,
    p_permanent: body.permanent === true,
    p_erase_history: body.permanent === true && body.eraseHistory === true,
  });
  if (error) {
    const known = /Only a coach|can't remove yourself|isn't a client/i.test(error.message ?? "");
    return NextResponse.json({ error: known ? error.message : "Couldn't remove this client. Nothing was changed." }, { status: known ? 403 : 500 });
  }
  return NextResponse.json({ success: true, removalId: data });
}
