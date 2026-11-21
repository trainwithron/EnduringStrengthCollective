import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { countWaitingByCoach } from "@/lib/requests-waiting";

// The number on the app's icon (Ron, Nov 20, wave 3 C10): how many requests are waiting on the signed-in coach's own answer. Only that one number, only their own (every read is
// narrowed to coach_id = the caller); a client or anyone with nothing waiting gets 0. Read with the server's key because a request to train lives in a table the coach reads through a
// function, not directly. A failed read answers null (the icon is left as it was).
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 });
  const limited = await rateLimitResponse("requests-waiting-count", user.id, 240, 3600);
  if (limited) return limited;
  const counts = await countWaitingByCoach(createServiceRoleClient(), new Date(), user.id);
  return NextResponse.json({ count: counts ? counts.get(user.id) ?? 0 : null }, { headers: { "Cache-Control": "no-store" } });
}
