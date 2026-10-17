import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { groupsStillTheirs } from "@/lib/leaving-coach-groups";
import { exportEntries } from "@/lib/business-export";
import { zipStream } from "@/lib/zip-store";
import { exportLinkStillWorks, EXPORT_LINK_DAYS } from "@/lib/leaving-coach-policy";
import { EXIT_EXPORT_BUCKET, emailsForExport, exportFileName } from "@/lib/leaving-coach-export";

// The one export a coach gets when their coaching access has ended (they used their seven days, or were let go). It was made once, at the moment access ended, and kept privately, so it never changes after
// that: this route checks who is asking, that it is their own and that the 30 days have not passed, then hands out a short-lived link to that file. Only if the file could not be made (the job retries) is the
// download made on the spot, and then only from groups that still belong to that organization and have no other coach, read as they are now. The coach id always comes from the session.
export const maxDuration = 300;

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to download your export." }, { status: 401 });

  const limited = await rateLimitResponse("coach-exit-export", user.id, 6, 3600);
  if (limited) return limited;

  const db = createServiceRoleClient();
  const { data: rows, error } = await db
    .from("organization_memberships")
    .select("organization_id, access_ended_at, departing_group_ids, export_path, organizations ( name, display_name )")
    .eq("profile_id", user.id)
    .not("access_ended_at", "is", null)
    .order("access_ended_at", { ascending: false })
    .limit(5);
  if (error) return NextResponse.json({ error: "Couldn't find your export. Try again." }, { status: 500 });
  const wanted = new URL(request.url).searchParams.get("organizationId");
  const row = ((rows ?? []) as any[]).find((r) => !wanted || r.organization_id === wanted);
  if (!row) return NextResponse.json({ error: "There is no export waiting for you." }, { status: 404 });
  if (!exportLinkStillWorks(row.access_ended_at, new Date())) {
    return NextResponse.json({ error: `This link worked for ${EXPORT_LINK_DAYS} days and has expired. Write to support and we will help.` }, { status: 410 });
  }
  const orgName: string = row.organizations?.display_name || row.organizations?.name || "my-business";

  // The frozen file.
  if (row.export_path) {
    const { data: signed, error: signError } = await db.storage.from(EXIT_EXPORT_BUCKET).createSignedUrl(row.export_path, 120, { download: exportFileName(orgName) });
    if (signError || !signed?.signedUrl) return NextResponse.json({ error: "Couldn't get your export. Try again in a minute." }, { status: 502 });
    return NextResponse.redirect(signed.signedUrl, 302);
  }

  // Not made yet (the job retries every few hours): the groups they kept that are still without any other coach and still in that organization.
  const kept: string[] = row.departing_group_ids ?? [];
  if (kept.length === 0) return NextResponse.json({ error: "There is nothing to export." }, { status: 404 });
  const still = await groupsStillTheirs(db, row.organization_id, kept);
  if (still.failed) return NextResponse.json({ error: "Couldn't prepare your export. Try again in a few minutes." }, { status: 502 });
  const groupIds = still.ids;
  if (groupIds.length === 0) return NextResponse.json({ error: "Your export is still being prepared. Try again in a few hours." }, { status: 404 });

  const stream = zipStream(exportEntries({ supabase: db, groupIds, orgName, emailsFor: emailsForExport(db) }));
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportFileName(orgName)}"`,
      "Cache-Control": "no-store",
    },
  });
}
