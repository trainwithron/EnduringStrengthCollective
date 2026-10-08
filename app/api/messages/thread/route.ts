import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { loadDirectThread } from "@/lib/direct-thread";

// One conversation between the signed-in coach and one of their clients, for the panes that open a thread in place (the All messages page and the floating panel). Loading it IS the
// "seen it" moment (lib/direct-thread.ts marks what the client sent as read), so the browser calls this only when the thread is on screen: never for a hidden panel or tab.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") ?? "";
  const otherId = url.searchParams.get("otherId") ?? "";
  if (!groupId || !otherId) return NextResponse.json({ error: "Missing groupId or otherId" }, { status: 400 });

  // Only a coach of this group, and only with an athlete of this group (row security refuses anything else anyway).
  const [{ data: mine }, { data: theirs }] = await Promise.all([
    supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle(),
    supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", otherId).maybeSingle(),
  ]);
  if (mine?.role !== "coach" || theirs?.role !== "athlete") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await loadDirectThread(supabase, { groupId, viewerId: user.id, otherId });
  return NextResponse.json({ messages });
}
