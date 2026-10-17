import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { exportEntries } from "@/lib/business-export";
import { zipStream } from "@/lib/zip-store";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { runPool } from "@/lib/run-pool";
import { exportLinkStillWorks, EXPORT_LINK_DAYS } from "@/lib/leaving-coach-policy";

// The one export a coach gets when their coaching access has ended (they used their seven days, or were let go): the emailed link lands here. It needs the coach signed in, works for EXPORT_LINK_DAYS after
// access ended, and covers only the groups they kept when they were marked leaving. Read with the server key because their seats in those groups are gone by now; the coach id comes from the session, never
// from the request. The clients and their records are not touched.
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
    .select("organization_id, access_ended_at, departing_group_ids, organizations ( name, display_name )")
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
  const groupIds: string[] = row.departing_group_ids ?? [];
  if (groupIds.length === 0) return NextResponse.json({ error: "There is nothing to export." }, { status: 404 });

  const orgName: string = row.organizations?.display_name || row.organizations?.name || "my-business";
  const emailsFor = async (ids: string[]) => {
    const found = new Map<string, string>();
    await runPool(ids, 8, async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      const email = data?.user?.email;
      if (email && !isPlaceholderEmail(email)) found.set(id, email);
    });
    return found;
  };

  const stream = zipStream(exportEntries({ supabase: db, groupIds, orgName, emailsFor }));
  const safeName = orgName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "my-business";
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
