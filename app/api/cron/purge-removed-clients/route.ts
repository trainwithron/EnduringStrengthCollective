import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { purgeDueRemovals } from "@/lib/client-removal-server";

// Daily: erases the accounts of clients a coach deleted permanently more than 30 days ago and did not put back (lib/client-removal-server.ts). Same CRON_SECRET/service-role pattern as every other scheduled job.
export const maxDuration = 300;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const tally = await purgeDueRemovals(createServiceRoleClient());
  return NextResponse.json(tally);
}

export const GET = withCronRun("purge-removed-clients", handler);
