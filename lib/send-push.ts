import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by the authenticated /api/push/send route and the headless
// coach-digest cron route — takes whichever Supabase client the caller
// already has (RLS-respecting or service-role) so both share one
// implementation of "look up subscriptions, send, clean up dead ones."
export async function sendPushToProfile(
  supabase: SupabaseClient,
  profileId: string,
  title: string,
  body: string,
  url: string
): Promise<number> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return 0;

  webpush.setVapidDetails("mailto:support@enduringstrength.co", publicKey, privateKey);

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("profile_id", profileId);

  if (!subscriptions || subscriptions.length === 0) return 0;

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify({ title, body, url })
      );
      sent += 1;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
  return sent;
}
