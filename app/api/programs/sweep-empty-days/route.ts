import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isBrandNewProgram, sweepEmptyDays } from "@/lib/empty-sweep";

// Called once as a coach opens a program in the builder, with the empty days it was opened with. Removes the ones that are still empty (no exercise, not named Rest day, no log, session, note, scheduled date
// or assignment) and says which went, so the builder drops them from the screen. A brand-new program is left alone. The coach's own access (row policies) decides what can be deleted.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" ? body.programId : "";
  const dayIds: string[] = Array.isArray(body.dayIds) ? body.dayIds.filter((d: unknown): d is string => typeof d === "string").slice(0, 200) : [];
  if (!programId || dayIds.length === 0) return NextResponse.json({ removed: [] });
  const { data: program } = await supabase.from("programs").select("created_at").eq("id", programId).maybeSingle();
  if (!program || isBrandNewProgram((program as { created_at?: string }).created_at)) return NextResponse.json({ removed: [] });
  const removed = await sweepEmptyDays(supabase, programId, dayIds);
  return NextResponse.json({ removed });
}
