import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { loadCoachInbox } from "@/lib/coach-inbox-data";
import { URGENT_NOTICE_TYPES } from "@/lib/messages-list";

// The coach's conversation list for the floating panel's Messages tab. Read only: nothing is marked read here (opening a thread does that, through /api/messages/thread).
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const groupId = new URL(request.url).searchParams.get("groupId") ?? "";
  if (!groupId) return NextResponse.json({ error: "Missing groupId" }, { status: 400 });

  const { data: mine } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (mine?.role !== "coach") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { conversations, incomplete } = await loadCoachInbox(supabase, { coachId: user.id, groupId });
  const [{ data: me }, { data: notices }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    // The same urgent lines the bell shows (schedule, pause, freeze and cancel requests, late changes), unread only. Reading them here marks nothing.
    supabase.from("notifications").select("id, body, link_path, created_at").eq("profile_id", user.id).in("type", [...URGENT_NOTICE_TYPES]).is("read_at", null).order("created_at", { ascending: false }).limit(5),
  ]);
  return NextResponse.json({
    conversations,
    incomplete,
    notices: (notices ?? []).map((n: { id: string; body: string; link_path: string | null; created_at: string }) => ({ id: n.id, body: n.body, linkPath: n.link_path, createdAt: n.created_at })),
    viewerId: user.id,
    viewerName: (me as { full_name?: string } | null)?.full_name ?? "You",
  });
}
