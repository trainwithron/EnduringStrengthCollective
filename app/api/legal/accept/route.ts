import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LEGAL_VERSIONS, type LegalDocument } from "@/lib/legal";
import { recordLegalAcceptances } from "@/lib/legal-record";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { DEFAULT_WAIVER_TEXT } from "@/lib/intake-waiver";
import { buildWaiverSnapshot } from "@/lib/waiver-snapshot";

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
  });
  return NextResponse.json({ ok: true, recorded });
}

async function buildServerWaiverSnapshot(db: ReturnType<typeof createServiceRoleClient>, profileId: string): Promise<string | null> {
  const { data: intake } = await db
    .from("client_intake")
    .select("group_id, waiver_accepted, waiver_signed_name, completed_at")
    .eq("athlete_id", profileId)
    .maybeSingle();
  if (!intake || !intake.waiver_accepted || !intake.completed_at || !intake.waiver_signed_name) return null;

  const { data: group } = await db.from("groups").select("organization_id").eq("id", intake.group_id).maybeSingle();
  const { data: org } = group?.organization_id
    ? await db.from("organizations").select("id, name, waiver_text, waiver_pdf_path").eq("id", group.organization_id).maybeSingle()
    : { data: null };

  let pdf: { path: string; sha256: string; copyPath: string | null } | null = null;
  if (org?.waiver_pdf_path) {
    const { data: file } = await db.storage.from("waiver-documents").download(org.waiver_pdf_path);
    if (file) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      // Keep a copy under a name built from the fingerprint, so replacing the coach's PDF later does not erase what this person signed.
      const copyPath = `${org.id}/signed/${sha256}.pdf`;
      const { error: copyError } = await db.storage.from("waiver-documents").upload(copyPath, bytes, { contentType: "application/pdf", upsert: false });
      const kept = !copyError || /already exists|duplicate/i.test(copyError.message);
      pdf = { path: org.waiver_pdf_path, sha256, copyPath: kept ? copyPath : null };
    } else {
      pdf = { path: org.waiver_pdf_path, sha256: "unavailable (the file could not be read)", copyPath: null };
    }
  }

  return buildWaiverSnapshot({
    organizationName: org?.name ?? null,
    waiverText: org?.waiver_text ?? null,
    defaultText: DEFAULT_WAIVER_TEXT,
    pdf,
    signedName: intake.waiver_signed_name,
    signedAtIso: intake.completed_at,
  });
}
