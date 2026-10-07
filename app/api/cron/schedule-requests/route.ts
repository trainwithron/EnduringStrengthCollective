import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { supabaseSeriesStore } from "@/lib/series-store";
import { runDueFreezeResumes, runDueScheduleRequests } from "@/lib/schedule-requests";
import { withCronRun } from "@/lib/cron-monitor";

// Runs daily, before the top-up job. (1) Applies every client request to pause, freeze or cancel whose chosen day has ended (in the schedule's own time zone): the
// schedule changes with the existing engine, the client is told, and so is the coach. (2) Starts every frozen schedule whose resume day has come. A request that cannot
// be applied is tried again on the next run, three times at most, and the coach is told when it keeps failing. Nothing here touches money; a freeze only moves the
// expiry hold of the client's unused sessions (in the database).
export const maxDuration = 60;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = createServiceRoleClient();
  const store = supabaseSeriesStore(db);

  let requests = { applied: 0, failed: 0 };
  let resumes = { resumed: 0, failed: 0 };
  let skipped: string | null = null;
  try {
    requests = await runDueScheduleRequests(db, store);
    resumes = await runDueFreezeResumes(db, store);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Until the database update that adds these functions is applied there is nothing to do.
    if (/could not find the function|does not exist|schema cache/i.test(message)) {
      skipped = "schedule requests are not set up yet";
    } else {
      throw err;
    }
  }

  // When every attempt failed the run is marked failed in the job monitor, so someone looks.
  const attempts = requests.applied + requests.failed + resumes.resumed + resumes.failed;
  if (!skipped && attempts > 0 && requests.applied + resumes.resumed === 0) {
    return NextResponse.json({ ok: false, error: "every schedule change failed", requests, resumes }, { status: 500 });
  }
  return NextResponse.json({ ok: true, skipped, requests, resumes });
}

export const GET = withCronRun("schedule-requests", handler);
