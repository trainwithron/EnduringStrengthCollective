import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { rateLimitResponse } from "@/lib/rate-limit";
import { exportEntries } from "@/lib/business-export";
import { zipStream } from "@/lib/zip-store";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { runPool } from "@/lib/run-pool";

// "Export my business": a ZIP of CSV files with the coach's clients, programs, workouts, sets, bookings, credits and notes for the organization they are standing in. Read as the signed-in coach (row
// security decides what is in it); sent as it is made. Only the clients' sign-in emails are looked up with the server key, and only for clients already read as this coach.
export const maxDuration = 300;

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const groupId = new URL(request.url).searchParams.get("groupId") ?? "";
  if (!groupId) return NextResponse.json({ error: "Missing the group." }, { status: 400 });

  const coached = await getCoachedGroups(supabase, user.id);
  const inOrg = groupsInOrgOf(coached, groupId);
  if (inOrg.length === 0) return NextResponse.json({ error: "Only a coach of this organization can export its data." }, { status: 403 });

  const limited = await rateLimitResponse("coach-export", user.id, 6, 3600);
  if (limited) return limited;

  const orgName = inOrg[0].orgName;
  const db = createServiceRoleClient();
  const emailsFor = async (ids: string[]) => {
    const found = new Map<string, string>();
    await runPool(ids, 8, async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      const email = data?.user?.email;
      if (email && !isPlaceholderEmail(email)) found.set(id, email);
    });
    return found;
  };

  const stream = zipStream(exportEntries({ supabase, groupIds: inOrg.map((g) => g.id), orgName, emailsFor }));
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
