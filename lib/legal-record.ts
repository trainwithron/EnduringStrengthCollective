import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL_VERSIONS, type LegalDocument } from "@/lib/legal";

// Writes "this person accepted this version of this document, then, from this address and device" (migration 0255).
// Rows are only ever added, never changed. If the table is not there yet this quietly does nothing, so a missing
// migration never stops a signup or a claim.
export async function recordLegalAcceptances(
  serviceRole: SupabaseClient,
  args: {
    profileId: string;
    documents: LegalDocument[];
    ip: string | null;
    userAgent: string | null;
    // The exact text signed, kept with the acceptance (for the waiver).
    snapshots?: Partial<Record<LegalDocument, string>>;
  }
): Promise<boolean> {
  const rows = args.documents.map((document) => ({
    profile_id: args.profileId,
    document,
    version: LEGAL_VERSIONS[document],
    ip: args.ip,
    user_agent: args.userAgent ? args.userAgent.slice(0, 400) : null,
    text_snapshot: args.snapshots?.[document]?.slice(0, 40_000) ?? null,
  }));
  if (rows.length === 0) return true;
  const { error } = await serviceRole
    .from("legal_acceptances")
    .upsert(rows, { onConflict: "profile_id,document,version", ignoreDuplicates: true });
  return !error;
}
