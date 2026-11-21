import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { coachNoticeIsOff } from "@/lib/coach-notice";
import { kindFromPushUrl } from "@/lib/coach-notice-kinds";
import { clampPush, mayPushTo, pushPairKey } from "@/lib/push-pair";
import { rateLimitResponse } from "@/lib/rate-limit";
import { safePushPath } from "@/lib/push-url";
import { parseWorkoutDonePayload, workoutDonePushBody } from "@/lib/pr-wording";
import { loadLiftUnit } from "@/lib/lift-unit-server";
import type { WeightUnit } from "@/lib/units";

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

  // Nobody is told about their own actions (the coach's own training in their personal space).
  if (profileId === user.id) return NextResponse.json({ sent: 0 });

  // The recipient's subscriptions are not readable with the sender's own session (a client cannot read their coach's), so the
  // push is sent with the server's access, after checking the two really share a group or organization.
  const db = createServiceRoleClient();
  if (!(await mayPushTo(db, user.id, profileId))) {
    return NextResponse.json({ sent: 0 });
  }
  // One sender never pings the same person more than ten times an hour through this route. (Per sender AND recipient: a coach receives pushes from every client, so a cap on the recipient alone would starve them.)
  const limitedTarget = await rateLimitResponse("push-to", pushPairKey(user.id, profileId), 10, 3600);
  if (limitedTarget) return limitedTarget;
  // The recipient's own switch for this KIND of notice (read from the page the push opens): a coach who switched messages, client activity... off is not pushed about them.
  const url = safePushPath(payload.url);
  const kind = kindFromPushUrl(url);
  if (kind && (await coachNoticeIsOff(db, profileId, kind))) return NextResponse.json({ sent: 0 });
  // A finished workout's records (wave 2, P3): the words are written here, in the recipient's OWN unit (the coach's setting, which the client's browser cannot read), and
  // nothing about that unit goes back to the sender. Past 1.5 seconds, or anything odd in what was sent: pounds, or the sender's own text.
  let text = body;
  const workoutDone = parseWorkoutDonePayload(payload.workoutDone);
  if (workoutDone) {
    const unit = await Promise.race([loadLiftUnit(db, profileId), new Promise<WeightUnit>((resolve) => setTimeout(() => resolve("lb"), 1500))]);
    text = clampPush(title, workoutDonePushBody(workoutDone.athleteName, workoutDone.prs, workoutDone.records, unit)).body;
  }
  const sent = await sendPushToProfile(db, profileId, title, text, url);
  return NextResponse.json({ sent });
}
