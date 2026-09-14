import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getNeedsAttentionItems } from "@/lib/needs-attention-data";

// Backs the coach-desktop-shell's pinned "Needs attention" strip
// (coach_desktop_shell_identity_redesign.md) — the shell is a client
// component (it needs interactive drag-resize/collapse state), so it
// can't call the server-only getNeedsAttentionItems() directly the way
// the dashboard page does; this is a thin authenticated wrapper around
// the exact same computation, scoped to just the one group currently
// open (not every group this coach runs — the strip sits inside that
// group's own shell, so items from an unrelated group would read as
// confusing noise here, unlike the dashboard page's own opt-in
// cross-group "scope=all" toggle).
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const groupId = request.nextUrl.searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "Missing groupId" }, { status: 400 });

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ items: [] });

  const items = await getNeedsAttentionItems(supabase, { coachId: user.id, groupIds: [groupId] });
  return NextResponse.json({ items });
}
