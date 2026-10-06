import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { clampPush, mayPushTo } from "@/lib/push-pair";
import { rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "Push notifications aren't configured on the server." }, { status: 500 });
  }

  const limited = await rateLimitResponse("push-send", user.id, 120, 3600);
  if (limited) return limited;

  const payload = await request.json().catch(() => ({}));
  const profileId = typeof payload.profileId === "string" ? payload.profileId : "";
  const { title, body } = clampPush(payload.title, payload.body);
  if (!profileId || !title) {
    return NextResponse.json({ error: "Missing profileId or title" }, { status: 400 });
  }

  // The recipient's subscriptions are not readable with the sender's own session (a client cannot read their coach's), so the
  // push is sent with the server's access, after checking the two really share a group or organization.
  const db = createServiceRoleClient();
  if (!(await mayPushTo(db, user.id, profileId))) {
    return NextResponse.json({ sent: 0 });
  }
  const sent = await sendPushToProfile(db, profileId, title, body, typeof payload.url === "string" ? payload.url : "/");
  return NextResponse.json({ sent });
}
