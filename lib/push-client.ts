// Browser-side push subscribe/unsubscribe glue — not pure logic (talks
// to the Push API + our own API routes), so no unit tests here; the
// actual send/receive path is what's verified live.

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes.buffer;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<void> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error("Push notifications aren't configured.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      authKey: json.keys?.auth,
    }),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

// The browser's own permission answer, so the UI can say "you turned this off
// in your phone settings" instead of a generic failure. "unsupported" covers
// browsers with no Push API at all (including an iPhone Safari tab).
export function getPushPermission(): "granted" | "denied" | "default" | "unsupported" {
  if (!isPushSupported() || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

// Sends a real push to this person's own devices, so they see it arrive.
export async function sendTestPush(profileId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        title: "Notifications are on",
        body: "This is how your coach's messages will reach you.",
        url: "/",
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.sent ?? 0) > 0;
  } catch {
    return false;
  }
}
