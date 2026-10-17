import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isBrandNewProgram, sweepEmptyDays } from "@/lib/empty-sweep";

// Called when the coach taps "Remove N empty days" in the builder, with the empty days on screen. Removes the ones that are still empty (no exercise, not named Rest day, no log, session, note, scheduled date
// or assignment) and says which went, so the builder drops them from the screen. (A request that is not explicit leaves a brand-new program alone.) The coach's own access (row policies) decides what can be deleted.
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
  // The coach asking for it (the button in the builder) is deliberate; the brand-new-program guard only protects the automatic kind.
  const explicit = body.explicit === true;
  if (!program || (!explicit && isBrandNewProgram((program as { created_at?: string }).created_at))) return NextResponse.json({ removed: [] });
  const removed = await sweepEmptyDays(supabase, programId, dayIds);
  return NextResponse.json({ removed });
}
