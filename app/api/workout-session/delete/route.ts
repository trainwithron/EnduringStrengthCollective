import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deleteInProgressWorkout } from "@/lib/delete-workout";

// Delete workout: the checks, the delete and the video clean-up are in lib/delete-workout.ts. Takes only { sessionId }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await deleteInProgressWorkout({ db: supabase, admin: createServiceRoleClient(), userId: user.id, sessionId: body?.sessionId });
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, removedVideos: result.removedVideos });
}
