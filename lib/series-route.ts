import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { supabaseSeriesStore } from "@/lib/series-store";
import type { SeriesInput, SeriesMode } from "@/lib/series-engine";

// Shared by the recurring-session API routes. Each route is called by a signed-in coach; the engine itself runs with the
// service role (it books through book_session), so this is where the person is checked: they must coach the group.
export interface CoachCall {
  userId: string;
  db: any;
  store: ReturnType<typeof supabaseSeriesStore>;
}

export async function authorizeCoachCall(groupId: string | null | undefined): Promise<CoachCall | NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!groupId || typeof groupId !== "string") return NextResponse.json({ error: "Missing group." }, { status: 400 });

  const limited = await rateLimitResponse("series", user.id, 120, 3600);
  if (limited) return limited;

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only the coach can schedule sessions." }, { status: 403 });

  const db = createServiceRoleClient();
  return { userId: user.id, db, store: supabaseSeriesStore(db) };
}

export function isResponse(v: CoachCall | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}

// The client being scheduled has to be a member of this group.
export async function athleteIsInGroup(db: any, athleteId: string, groupId: string): Promise<boolean> {
  const { data } = await db.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  return data?.role === "athlete";
}

export function parseSeriesInput(body: any, coachId: string): SeriesInput | { error: string } {
  const mode: SeriesMode = body?.mode === "ongoing" ? "ongoing" : "fixed";
  if (typeof body?.athleteId !== "string" || typeof body?.groupId !== "string") return { error: "Missing client." };
  if (typeof body?.firstStartIso !== "string") return { error: "Pick a start date and time." };
  return {
    coachId,
    athleteId: body.athleteId,
    groupId: body.groupId,
    firstStartIso: body.firstStartIso,
    durationMinutes: Number(body.durationMinutes),
    mode,
    count: mode === "fixed" ? Number(body.count) : undefined,
    windowWeeks: mode === "ongoing" && body.windowWeeks != null ? Number(body.windowWeeks) : undefined,
    endsOn: mode === "ongoing" && typeof body.endsOn === "string" && body.endsOn ? body.endsOn : null,
    skipStartsIso: Array.isArray(body.skipStartsIso) ? body.skipStartsIso.filter((s: unknown) => typeof s === "string").slice(0, 400) : [],
  };
}
