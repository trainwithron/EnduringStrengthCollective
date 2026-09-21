import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getProgramBuilderData } from "@/lib/program-builder-data";

// Backs the embedded Program Builder inside ShellListPanel
// (components/coach/desktop/embedded-program-builder.tsx) — that panel
// is a client component, so it can't call the server-only
// getProgramBuilderData() directly the way the real
// /programs/[programId] page does. Same thin-authenticated-wrapper
// pattern as /api/coach/needs-attention. RLS (via the user's own
// authenticated client, not service-role) is the real access boundary
// here, same as the page itself — this route grants nothing beyond
// what the coach could already reach by visiting the real page.
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const groupId = request.nextUrl.searchParams.get("groupId");
  const programId = request.nextUrl.searchParams.get("programId");
  if (!groupId || !programId) {
    return NextResponse.json({ error: "Missing groupId or programId" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const data = await getProgramBuilderData(supabase, { groupId, programId, coachId: user.id });
  if (!data) return NextResponse.json({ error: "Program not found" }, { status: 404 });

  return NextResponse.json({ data });
}
