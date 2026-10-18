import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { fail, requireCoach, UUID } from "@/lib/team-sheet/coach-access";

// Taking back a whole saved upload: its workouts, sets, logs and the records they set go, and the records they replaced come back. Only a coach of the group the upload was saved in.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const body = (await request.json().catch(() => null)) as { groupId?: unknown; batchId?: unknown } | null;
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const batchId = typeof body?.batchId === "string" ? body.batchId : "";
  const access = await requireCoach(supabase, groupId);
  if (!access.ok) return access.response;
  if (!UUID.test(batchId)) return fail(400, "Choose an upload to undo.");

  const limited = await rateLimitResponse("team-sheet-undo", access.userId, 30, 3600);
  if (limited) return limited;

  // the upload must belong to the group the coach is acting in
  const { data: batch, error: batchError } = await supabase.from("team_sheet_batches").select("id, group_id").eq("id", batchId).maybeSingle();
  if (batchError) return fail(502, "Couldn't read that upload. Try again.");
  if (!batch || batch.group_id !== groupId) return fail(404, "That upload was not found.");

  const { data, error } = await supabase.rpc("team_sheet_undo", { p_batch: batchId });
  if (error) {
    if (/already undone/i.test(error.message)) return fail(409, "That upload was already undone.");
    if (/not found/i.test(error.message)) return fail(404, "That upload was not found.");
    return fail(502, "Couldn't undo that upload. Nothing was changed. Try again.");
  }
  return NextResponse.json(data as Record<string, unknown>, { headers: { "Cache-Control": "no-store" } });
}
