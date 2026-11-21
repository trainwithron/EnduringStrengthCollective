import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitAllows } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { getActiveAnchor } from "@/lib/active-anchor";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { checkinPath, reminderPush, REMIND_LIMIT_SECONDS } from "@/lib/weekly-checkin";
import { loadCoachCheckins } from "@/lib/weekly-checkin-coach";

// "Remind them" on Check-ins (Ron, Nov 20: R2): one push to each signed-in client in the open organization who has not sent this week's check-in. Worked out again here (never a
// list from the browser). Once a day per coach; each client's own quiet hours and private lock screen apply (lib/send-push.ts), so someone in their quiet hours is not woken.
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const active = await getActiveAnchor(supabase, user.id);
  if (!active?.anchor || active.needsChoice) return NextResponse.json({ error: "Open your organization first." }, { status: 400 });
  const groupIds = active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id);
  const { data: me } = await supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle();
  const timeZone = isValidTimeZone(me?.timezone) ? (me!.timezone as string) : DEFAULT_COACH_TIMEZONE;
  const data = await loadCoachCheckins(supabase, { coachId: user.id, anchorGroupId: active.anchor.id, groupIds, timeZone });
  if (!data.available) return NextResponse.json({ error: "Check-ins aren't switched on yet." }, { status: 503 });
  if (data.notSent.length === 0) return NextResponse.json({ reminded: 0 });

  // once a day: the day's one reminder is used only when there is someone to remind
  if (!(await rateLimitAllows(`checkin-remind:${user.id}`, 1, REMIND_LIMIT_SECONDS))) {
    return NextResponse.json({ error: "You already reminded them today. You can send another tomorrow." }, { status: 429 });
  }

  const db = createServiceRoleClient();
  const words = reminderPush(me?.full_name as string | null | undefined);
  let reminded = 0;
  for (const c of data.notSent.slice(0, 500)) {
    const phones = await sendPushToProfile(db, c.id, words.title, words.body, checkinPath(c.groupId)).catch(() => 0);
    if (phones > 0) reminded += 1;
  }
  return NextResponse.json({ reminded, asked: data.notSent.length });
}
