import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { shouldAlertForFailures } from "@/lib/cron-jobs";
import { trackAiRun, everyAiCallFailed } from "@/lib/ai-run-stats";

// Wraps a scheduled job so every run is recorded (cron_runs) and a failure tells the platform admin. A job that throws is turned
// into a clean 500 and an alert; one that returns an error status counts as failed too. A request without the cron secret
// (401) is somebody probing, not a run, so it is not recorded. Recording and alerting are best effort: monitoring must never
// be the reason a job fails.
export async function alertPlatformAdmins(subject: string, body: string): Promise<void> {
  try {
    const db = createServiceRoleClient();
    const { data: admins } = await db.from("profiles").select("id").eq("is_platform_admin", true);
    for (const admin of admins ?? []) {
      await sendPushToProfile(db, admin.id as string, subject, body.slice(0, 160), "/admin/health").catch(() => 0);
      if (isEmailConfigured()) {
        const { data: authUser } = await db.auth.admin.getUserById(admin.id as string);
        const to = authUser?.user?.email;
        if (to) await sendEmail(to, subject, body).catch(() => false);
      }
    }
  } catch {
    // Quiet: see above.
  }
}

async function recordRun(job: string, ok: boolean, error: string | null): Promise<number> {
  try {
    const db = createServiceRoleClient();
    const { data: existing } = await db.from("cron_runs").select("consecutive_failures").eq("job", job).maybeSingle();
    const failures = ok ? 0 : (existing?.consecutive_failures ?? 0) + 1;
    const now = new Date().toISOString();
    await db.from("cron_runs").upsert(
      {
        job,
        last_run_at: now,
        ...(ok ? { last_success_at: now } : {}),
        last_status: ok ? "ok" : "error",
        last_error: ok ? null : (error ?? "failed").slice(0, 500),
        consecutive_failures: failures,
        updated_at: now,
      },
      { onConflict: "job" }
    );
    return failures;
  } catch {
    // The table is not there yet, or the write failed.
    return 0;
  }
}

export function withCronRun(job: string, handler: (request: Request) => Promise<Response>) {
  return async function GET(request: Request): Promise<Response> {
    let response: Response;
    // Every AI call the job makes is counted, so a run where each one failed is recorded as a failure even though the job swallowed the errors.
    const ai = { problem: null as string | null };
    try {
      response = await trackAiRun(async (stats) => {
        const r = await handler(request);
        if (everyAiCallFailed(stats)) ai.problem = `every AI call in this run failed (${stats.failures} of ${stats.attempts}): ${stats.lastClass ?? "unknown"}`;
        return r;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`cron ${job} threw:`, message);
      const failures = await recordRun(job, false, message);
      if (shouldAlertForFailures(failures)) {
        await alertPlatformAdmins(`Scheduled job failed: ${job}`, `${job} failed (${failures} in a row): ${message}`);
      }
      return NextResponse.json({ error: "Job failed." }, { status: 500 });
    }

    if (response.status === 401) return response;
    const ok = response.status < 400 && !ai.problem;
    const reason = ai.problem ?? `returned status ${response.status}`;
    const failures = await recordRun(job, ok, ok ? null : reason);
    if (!ok && shouldAlertForFailures(failures)) {
      await alertPlatformAdmins(`Scheduled job failed: ${job}`, `${job}: ${reason} (${failures} in a row).`);
    }
    return response;
  };
}
