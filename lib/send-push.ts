import webpush from "web-push";
import { supportEmail } from "@/lib/legal";
import { configuredAppUrl } from "@/lib/app-url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safePushPath } from "@/lib/push-url";
import { isQuietNow, pushContent, readPushPrefs } from "@/lib/push-prefs";

// Shared by the authenticated /api/push/send route and the headless
// coach-digest cron route — takes whichever Supabase client the caller
// already has (RLS-respecting or service-role) so both share one
// implementation of "look up subscriptions, send, clean up dead ones."
//
// The person's own preferences apply (lib/push-prefs.ts): during their quiet hours nothing is pushed (the notice in the app is unaffected; `ignoreQuiet` is for the platform's own operations alerts), and with
// private lock screens on the phone is shown only "You have a new notification".
export async function sendPushToProfile(
  supabase: SupabaseClient,
  profileId: string,
  title: string,
  body: string,
  url: string,
  opts: { ignoreQuiet?: boolean } = {}
): Promise<number> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return 0;

  const prefs = await readPushPrefs(supabase, profileId);
  if (!opts.ignoreQuiet && isQuietNow(prefs)) return 0;
  const shown = pushContent(prefs, title, body);

  webpush.setVapidDetails(vapidSubject(), publicKey, privateKey);

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
        JSON.stringify({ title: shown.title, body: shown.body, url: safePushPath(url) })
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

// The contact the push services get with every send: VAPID_SUBJECT if set, else the support address, else the app's own address. Never a made-up one.
export function vapidSubject(): string {
  const fromEnv = process.env.VAPID_SUBJECT?.trim();
  if (fromEnv) return fromEnv;
  const email = supportEmail();
  if (email) return `mailto:${email}`;
  return configuredAppUrl() ?? "https://localhost";
}
