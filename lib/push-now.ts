import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { isQuietNow, readPushPrefs } from "@/lib/push-prefs";
import { pushBodyFor, pushTitleFor } from "@/lib/notification-push";
import { noticeHref } from "@/lib/notice-links";

// The answer goes to the client's phone the moment the coach answers (Ron, Nov 19: Hewan's came about 4 minutes late, from the five-minute push job). Called by the answer routes right after the
// database wrote the client's notice: the notice is claimed (pushed_at) the way the job claims it, so the job never sends it again; in the client's quiet hours it is left for the job, which sends it
// when the quiet hours end. A failed push gives the notice back to the job. Never throws: the answer stands whatever happens here.
export async function pushNoticeNow(profileId: string, type: string, sinceIso: string): Promise<number> {
  try {
    const db = createServiceRoleClient();
    if (isQuietNow(await readPushPrefs(db, profileId))) return 0;
    const { data: claimed, error } = await db
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .eq("profile_id", profileId)
      .eq("type", type)
      .is("pushed_at", null)
      .gte("created_at", sinceIso)
      .select("id, type, group_id, link_path");
    if (error || !claimed) return 0;
    let sent = 0;
    for (const n of claimed as { id: string; type: string; group_id: string | null; link_path: string | null }[]) {
      try {
        sent += await sendPushToProfile(db, profileId, pushTitleFor(n.type), pushBodyFor(n.type), noticeHref(n.type, n.link_path, { id: n.id, groupId: n.group_id }));
      } catch {
        await db.from("notifications").update({ pushed_at: null }).eq("id", n.id);
      }
    }
    return sent;
  } catch {
    return 0;
  }
}

/** A minute before now: the notice is written by the same database call as the answer, so anything newer and not yet pushed is this answer's (or one the job would push next anyway). */
export function justBefore(now: Date = new Date()): string {
  return new Date(now.getTime() - 60_000).toISOString();
}
