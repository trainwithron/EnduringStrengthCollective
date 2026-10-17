import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { appOrigin } from "@/lib/app-url";
import { rateLimitResponse } from "@/lib/rate-limit";
import { resendAccess } from "@/lib/resend-access";

// "Resend invite / send a sign-in link" for a client the coach coaches, in whatever state the client is in (see lib/resend-access.ts for what is sent and the only waits).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("resend-access", user.id, 60, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const body: { groupId?: unknown; athleteId?: unknown } = raw && typeof raw === "object" ? raw : {};
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing groupId or athleteId." }, { status: 400 });

  const result = await resendAccess({ supabase, serviceRole: createServiceRoleClient(), coachId: user.id, groupId, athleteId, origin: appOrigin(request) });
  return NextResponse.json(result.body, { status: result.status });
}
