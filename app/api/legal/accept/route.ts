import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LEGAL_VERSIONS, type LegalDocument } from "@/lib/legal";
import { recordLegalAcceptances } from "@/lib/legal-record";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";

const ALLOWED: LegalDocument[] = ["beta_notice", "terms", "privacy", "refunds", "waiver"];

// A signed-in person records that they accepted the current version of one or more documents. The address and device
// are taken from the request here on the server, never from what the browser says, and the waiver's exact text is kept
// with it.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await rateLimitResponse("legal-accept", user.id, 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const documents = (Array.isArray(body.documents) ? body.documents : []).filter(
    (d: unknown): d is LegalDocument => typeof d === "string" && (ALLOWED as string[]).includes(d) && d in LEGAL_VERSIONS
  );
  if (documents.length === 0) return NextResponse.json({ error: "Nothing to record." }, { status: 400 });
  const waiverText = typeof body.waiverText === "string" ? body.waiverText : undefined;

  const recorded = await recordLegalAcceptances(createServiceRoleClient(), {
    profileId: user.id,
    documents,
    ip: clientIp(request) === "unknown" ? null : clientIp(request),
    userAgent: request.headers.get("user-agent"),
    snapshots: waiverText ? { waiver: waiverText } : undefined,
  });
  return NextResponse.json({ ok: true, recorded });
}
