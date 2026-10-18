import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { requestGuardianConsent } from "@/lib/guardian-consent-server";

// A client aged 13 to 17 asks a parent or guardian for permission: this emails the guardian a one-time link. Only about themselves; the child is read from their own sign-in, never from the request.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Each call sends an email to an address the child typed: limited per child per day, and per network address.
  const byChild = await rateLimitResponse("guardian-request", user.id, 6, 86400);
  if (byChild) return byChild;
  const byIp = await rateLimitResponse("guardian-request-ip", clientIp(request), 20, 86400);
  if (byIp) return byIp;

  const body = (await request.json().catch(() => ({}))) as { guardianEmail?: unknown };
  const guardianEmail = typeof body.guardianEmail === "string" ? body.guardianEmail : "";

  const result = await requestGuardianConsent(createServiceRoleClient(), { athleteId: user.id, guardianEmail, requestedBy: user.id, origin: appOrigin(request) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
