import { NextResponse } from "next/server";
import webpush from "web-push";
import { createServerClient } from "@/lib/supabase/server";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

export async function POST(request: Request) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "Push notifications aren't configured on the server." }, { status: 500 });
  }

  const { profileId, title, body, url } = await request.json();
  if (!profileId || !title) {
    return NextResponse.json({ error: "Missing profileId or title" }, { status: 400 });
  }

  webpush.setVapidDetails("mailto:support@enduringstrength.co", publicKey, privateKey);

  // RLS on push_subscriptions decides who this caller is actually
  // allowed to see — either their own subscriptions, or (for a coach)
  // one of their real clients'. A coach can't reach anyone else's.
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("profile_id", profileId);

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sent: 0, message: "No push subscription for this person." });
  }

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        JSON.stringify({ title, body, url })
      );
      sent += 1;
    } catch (err: any) {
      // Endpoint no longer valid (browser unsubscribed, device reset,
      // etc.) — clean it up rather than retrying a dead subscription.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  return NextResponse.json({ sent });
}
