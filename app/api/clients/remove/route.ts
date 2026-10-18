import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { deletionBlocker, loadDeletionFacts } from "@/lib/account-deletion";

// A coach takes a client out of a group: "Remove from my clients" (kept, restorable) or "Delete permanently" (the same removal, with 30 days to undo before the account is erased). The rules are in the database
// function remove_client (migration 0407); it runs as the coach, so it refuses anyone who does not coach the group, refuses a client with a live subscription in the group, cancels their upcoming sessions (credits come
// back) and keeps their rate for a Put back. A permanent delete is also refused now (not on day 30) when the account could not be erased at the end: a live subscription anywhere, a platform administrator, or someone who
// coaches or owns groups.
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
  const permanent = body.permanent === true;

  if (permanent) {
    // Only for someone who coaches this group (row security decides), so nothing about other accounts is revealed to anyone else.
    const { data: coachRow } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
    if (coachRow?.role !== "coach") return NextResponse.json({ error: "Only a coach of this group can remove a client." }, { status: 403 });
    const blocker = deletionBlocker(await loadDeletionFacts(createServiceRoleClient(), athleteId));
    if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("remove_client", {
    p_group: groupId,
    p_athlete: athleteId,
    p_permanent: permanent,
    p_erase_history: permanent && body.eraseHistory === true,
  });
  if (error) {
    const message = error.message ?? "";
    if (/live subscription/i.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    const known = /Only a coach|can't remove yourself|isn't a client/i.test(message);
    return NextResponse.json({ error: known ? message : "Couldn't remove this client. Nothing was changed." }, { status: known ? 403 : 500 });
  }
  const { data: record } = await supabase.from("client_removals").select("cancelled_bookings").eq("id", data).maybeSingle();
  return NextResponse.json({ success: true, removalId: data, cancelledBookings: (record as { cancelled_bookings?: number } | null)?.cancelled_bookings ?? 0 });
}
