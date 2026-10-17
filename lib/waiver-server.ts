import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_WAIVER_TEXT } from "@/lib/intake-waiver";
import { buildWaiverSnapshot } from "@/lib/waiver-snapshot";
import { LEGAL_VERSIONS } from "@/lib/legal";

// The record kept of what a client signed, built on the server from the coach's own waiver settings and the client's saved intake (never from text the browser sends). Returns null until the intake is
// really completed and signed. For an uploaded PDF the file itself is fingerprinted and a copy is kept next to the acceptance.
export async function buildServerWaiverSnapshot(db: SupabaseClient, profileId: string): Promise<string | null> {
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

// The version key of one signed waiver: the platform's waiver version plus a fingerprint of the words (or file) the client actually signed. A coach changing the waiver text therefore makes the NEXT
// signature a new, separate record, instead of being treated as a repeat of the old one. The signer's name and the time are left out of the fingerprint.
export function waiverVersionKey(snapshot: string): string {
  const body = snapshot
    .split("\n")
    .filter((line) => !/^Waiver accepted for /.test(line) && !/^Signed by typing: /.test(line))
    .join("\n");
  return `${LEGAL_VERSIONS.waiver}+${createHash("sha256").update(body).digest("hex").slice(0, 12)}`;
}
