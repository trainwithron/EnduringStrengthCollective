import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// The platform admin acts on a reported demo (Ron, Nov 20, S4): "remove" takes the video off where the report was made (the shared machine list's demo, or the gym's own exercise
// demo) and keeps the removed link on the report so it can be put back by hand; "dismiss" closes the report and changes nothing. Only the platform admin, checked under their own
// sign-in first; the server's key is used only after that check.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  if (!me?.is_platform_admin) return NextResponse.json({ error: "Only the Spotlight admin can do that." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  const action = body.action === "remove" || body.action === "dismiss" ? body.action : null;
  if (!id || !action) return NextResponse.json({ error: "Missing the report." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: report } = await db.from("video_reports").select("id, status, exercise_id, catalog_item_id").eq("id", id).maybeSingle();
  if (!report) return NextResponse.json({ error: "That report isn't here." }, { status: 404 });
  const r = report as { id: string; status: string; exercise_id: string | null; catalog_item_id: string | null };
  if (r.status !== "open") return NextResponse.json({ ok: true, status: r.status });

  if (action === "dismiss") {
    const { error } = await db.from("video_reports").update({ status: "dismissed", closed_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    if (error) return NextResponse.json({ error: "That didn't save." }, { status: 500 });
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  // remove: the shared list's demo when the report was about one, else the exercise's own
  const table = r.catalog_item_id ? "catalog_machine_exercises" : "exercise_library";
  const rowId = r.catalog_item_id ?? r.exercise_id;
  if (!rowId) return NextResponse.json({ error: "The video it was about is gone already." }, { status: 404 });
  const { data: row } = await db.from(table).select("video_path, youtube_url").eq("id", rowId).maybeSingle();
  if (!row) return NextResponse.json({ error: "The video it was about is gone already." }, { status: 404 });
  const was = row as { video_path: string | null; youtube_url: string | null };
  const { error: clearError } = await db.from(table).update({ video_path: null, youtube_url: null }).eq("id", rowId);
  if (clearError) return NextResponse.json({ error: "Couldn't remove it. Try again." }, { status: 500 });
  const { error } = await db
    .from("video_reports")
    .update({
      status: "removed",
      closed_at: new Date().toISOString(),
      removed_video_path: was.video_path,
      removed_youtube_url: was.youtube_url,
      removed_from: r.catalog_item_id ? "shared_list" : "exercise",
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "The video was removed, but the report didn't update." }, { status: 500 });
  return NextResponse.json({ ok: true, status: "removed" });
}
