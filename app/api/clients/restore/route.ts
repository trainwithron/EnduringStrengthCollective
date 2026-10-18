import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";

// A coach puts a removed client back exactly as they were, and cancels a scheduled delete. The database function restore_removed_client (migration 0407) checks the caller coaches the group and, if it cannot be done
// (the erase is already under way, a limit now refuses), says why in plain words and changes nothing.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("client-restore", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const removalId = typeof body.removalId === "string" ? body.removalId : "";
  if (!removalId) return NextResponse.json({ error: "Missing the removal." }, { status: 400 });

  const { data, error } = await supabase.rpc("restore_removed_client", { p_removal: removalId });
  if (error) {
    const message = error.message ?? "";
    const known = /not found|already been put back/i.test(message);
    const plain = /being deleted right now|can't be put back right now/i.test(message);
    return NextResponse.json({ error: known || plain ? message : "Couldn't put them back. Nothing was changed." }, { status: known ? 404 : plain ? 409 : 500 });
  }
  return NextResponse.json({ success: true, athleteId: data });
}
