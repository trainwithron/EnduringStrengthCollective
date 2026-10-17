import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LEGAL_VERSIONS, type LegalDocument } from "@/lib/legal";
import { recordLegalAcceptances } from "@/lib/legal-record";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { buildServerWaiverSnapshot, waiverVersionKey } from "@/lib/waiver-server";

const ALLOWED: LegalDocument[] = ["beta_notice", "terms", "privacy", "refunds", "waiver"];

// A signed-in person records that they accepted the current version of one or more documents. The address and device
// are taken from the request here on the server, never from what the browser says. For the waiver, the record of what was
// signed is built here too, from the coach's own waiver settings and the client's saved intake (the browser sends no text),
// and only once the client has really completed and signed their intake.
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

  const db = createServiceRoleClient();
  const snapshots: Partial<Record<LegalDocument, string>> = {};
  if (documents.includes("waiver")) {
    const snapshot = await buildServerWaiverSnapshot(db, user.id);
    if (!snapshot) return NextResponse.json({ error: "Finish and sign your intake first." }, { status: 409 });
    snapshots.waiver = snapshot;
  }

  const recorded = await recordLegalAcceptances(db, {
    profileId: user.id,
    documents,
    ip: clientIp(request) === "unknown" ? null : clientIp(request),
    userAgent: request.headers.get("user-agent"),
    snapshots,
    versions: snapshots.waiver ? { waiver: waiverVersionKey(snapshots.waiver) } : undefined,
  });
  return NextResponse.json({ ok: true, recorded });
}
