// The real web-push infrastructure (VAPID keys, /api/push/send, the
// subscribe/unsubscribe routes) was only ever wired to one caller — the
// coach's manual "Needs Attention" nudge. Every other event that already
// writes a real in-app notification row via a DB trigger (a comment, a
// reply, an @mention — see supabase/migrations/0073/0093) never also
// sent a push, so someone with push enabled got nothing on their phone
// for any of it. Postgres triggers can't make outbound HTTP calls in
// this project (no pg_net/webhook infra), so the client — which already
// knows exactly who it's notifying at the moment it performs the
// action — fires this right after the underlying insert succeeds.
//
// Fire-and-forget and best-effort on purpose: a push failing (no
// subscription, a dead endpoint, momentary network blip) must never
// surface as if the actual comment/post/reply itself failed. The
// in-app notification bell (written by the DB trigger, unaffected by
// this) is the reliable fallback either way.
export function notifyPush(profileId: string, title: string, body: string, url: string) {
  fetch("/api/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileId, title, body, url }),
  }).catch(() => {});
}
