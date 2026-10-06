import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { endpoint, p256dh, authKey } = body;
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }
  if (!isAllowedPushEndpoint(endpoint) || typeof p256dh !== "string" || typeof authKey !== "string" || p256dh.length > 200 || authKey.length > 100) {
    return NextResponse.json({ error: "That notification address isn't supported." }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    { profile_id: user.id, endpoint, p256dh, auth_key: authKey },
    { onConflict: "profile_id,endpoint" }
  );
  if (error) {
    console.error("push subscribe failed:", error.message);
    return NextResponse.json({ error: "We couldn't turn notifications on. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
