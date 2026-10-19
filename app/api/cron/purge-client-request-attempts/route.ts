import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";

// Daily: clears the record of tries on the requests to train with a coach, which is only needed for the hourly limits (client_request_attempts, kept two days) for EVERYONE, not just for the account that tried again,
// and the 30-day holds on accounts that gave an age under 13 once they have run out. Same CRON_SECRET/service-role pattern as every other scheduled job.
export const maxDuration = 60;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = createServiceRoleClient();
  const attempts = await db.from("client_request_attempts").delete({ count: "exact" }).lt("at", new Date(Date.now() - 2 * 86400000).toISOString());
  const blocks = await db.from("client_request_blocks").delete({ count: "exact" }).lt("until", new Date().toISOString());
  const failed = !!attempts.error || !!blocks.error;
  return NextResponse.json({ attemptsRemoved: attempts.count ?? 0, holdsRemoved: blocks.count ?? 0, failed }, { status: failed ? 500 : 200 });
}

export const GET = withCronRun("purge-client-request-attempts", handler);
