import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendPushToProfile } from "@/lib/send-push";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "Push notifications aren't configured on the server." }, { status: 500 });
  }

  const { profileId, title, body, url } = await request.json();
  if (!profileId || !title) {
    return NextResponse.json({ error: "Missing profileId or title" }, { status: 400 });
  }

  // RLS on push_subscriptions decides who this caller is actually
  // allowed to see — either their own subscriptions, or (for a coach)
  // one of their real clients'. A coach can't reach anyone else's.
  const sent = await sendPushToProfile(supabase, profileId, title, body, url);
  return NextResponse.json({ sent });
}
