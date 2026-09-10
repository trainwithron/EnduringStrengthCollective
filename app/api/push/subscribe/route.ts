import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const { endpoint, p256dh, authKey } = body;
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    { profile_id: user.id, endpoint, p256dh, auth_key: authKey },
    { onConflict: "profile_id,endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
