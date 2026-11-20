import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { REPORT_REASONS, reportReasonLabel, type ReportReason } from "@/lib/video-reports";

// "Report this video" on the public machine and exercise scan pages (Ron, Nov 20, S4): anyone, signed in or not (the pages need no sign-in), tells Spotlight about a demo, for
// example a person on camera who did not agree, a minor, someone else's video. The report is stored (video_reports, step 211: only the server writes it, only the platform admin
// reads it) and the admin is told at once by push and email; the admin removes the demo in one tap on the Machine requests page. Nothing about the person reporting is kept.
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const limited = await rateLimitResponse("scan-report-video", clientIp(request), 5, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { exerciseId?: unknown; machineId?: unknown; reason?: unknown; note?: unknown };
  const exerciseId = typeof body.exerciseId === "string" && UUID.test(body.exerciseId) ? body.exerciseId : null;
  const machineId = typeof body.machineId === "string" && UUID.test(body.machineId) ? body.machineId : null;
  const reason = typeof body.reason === "string" && (REPORT_REASONS as readonly string[]).includes(body.reason) ? (body.reason as ReportReason) : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!exerciseId || !reason) return NextResponse.json({ error: "Pick the video and a reason." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: exercise } = await db.from("exercise_library").select("id, name").eq("id", exerciseId).maybeSingle();
  if (!exercise) return NextResponse.json({ error: "That video isn't here any more." }, { status: 404 });

  // Opened from a machine added from the shared list: the demo shown is the shared list's (read the same way the page reads it).
  let catalogItemId: string | null = null;
  let machineName: string | null = null;
  if (machineId) {
    const [{ data: link }, { data: machine }] = await Promise.all([
      db.from("gym_machine_exercises").select("catalog_item_id").eq("machine_id", machineId).eq("exercise_id", exerciseId).maybeSingle(),
      db.from("gym_machines").select("name").eq("id", machineId).maybeSingle(),
    ]);
    catalogItemId = (link as { catalog_item_id?: string | null } | null)?.catalog_item_id ?? null;
    machineName = (machine as { name?: string } | null)?.name ?? null;
  }

  const { error } = await db.from("video_reports").insert({
    exercise_id: exerciseId,
    machine_id: machineId,
    catalog_item_id: catalogItemId,
    reason,
    note: note || null,
  });
  if (error) return NextResponse.json({ error: "That didn't send. Try again." }, { status: 500 });

  const { data: admins } = await db.from("profiles").select("id").eq("is_platform_admin", true);
  const what = `${(exercise as { name: string }).name}${machineName ? ` on ${machineName}` : ""}`;
  const headline = `Video reported: ${what}`;
  const line = `${reportReasonLabel(reason)}${note ? `: ${note}` : ""}`;
  for (const admin of admins ?? []) {
    await sendPushToProfile(db, admin.id as string, headline, line, "/admin/machine-catalog#reports", { ignoreQuiet: true }).catch(() => 0);
    if (isEmailConfigured()) {
      const { data: authUser } = await db.auth.admin.getUserById(admin.id as string);
      const to = authUser?.user?.email;
      if (to) await sendEmail(to, headline, `${line}\n\nRemove it or dismiss the report on the Machine requests page: /admin/machine-catalog#reports`).catch(() => false);
    }
  }
  return NextResponse.json({ ok: true });
}
