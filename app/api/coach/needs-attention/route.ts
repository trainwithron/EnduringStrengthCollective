import { readRowsByIds } from "@/lib/read-by-ids";
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
// One group goes in the address (GET ?groupId=). The coach's whole organization goes in the body of a POST ({ groupIds: [...] }): a coach with 1,500 one-on-one groups would send a 55 KB address,
// which is refused before this code runs.
export async function GET(request: NextRequest) {
  const one = request.nextUrl.searchParams.get("groupId");
  return respond(one ? [one] : []);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.groupIds) ? (body.groupIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 64) : [];
  return respond(ids.slice(0, 5000));
}

async function respond(requested: string[]) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Only groups this person actually coaches are ever used.
  if (requested.length === 0) return NextResponse.json({ error: "Missing groupId" }, { status: 400 });

  const { data: memberships } = await readRowsByIds(requested, (g) => (from, to) =>
    supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach").in("group_id", g).order("group_id").range(from, to)
  );
  const groupIds = (memberships ?? []).map((m) => m.group_id);
  if (groupIds.length === 0) return NextResponse.json({ items: [] });

  const items = await getNeedsAttentionItems(supabase, { coachId: user.id, groupIds });
  return NextResponse.json({ items });
}
