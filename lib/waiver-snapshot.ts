// The record kept of what a client signed. Built on the server from the coach's own waiver settings and the client's saved
// intake, never from text the browser sends: a browser could claim any wording, and an uploaded PDF is only a link that
// expires, so for a PDF the file itself is fingerprinted (SHA-256) and a copy is kept next to the acceptance.

export interface WaiverSnapshotInput {
  organizationName: string | null;
  // The coach's own typed waiver, or null to use the built-in template.
  waiverText: string | null;
  defaultText: string;
  pdf: { path: string; sha256: string; copyPath: string | null } | null;
  signedName: string;
  signedAtIso: string;
}

export function buildWaiverSnapshot(input: WaiverSnapshotInput): string {
  const header = `Waiver accepted for ${input.organizationName?.trim() || "the organization"} on ${input.signedAtIso}.`;
  const signed = `Signed by typing: ${input.signedName.trim()}`;
  if (input.pdf) {
    return [
      header,
      "The signed document is the coach's uploaded PDF.",
      `File: ${input.pdf.path}`,
      `SHA-256: ${input.pdf.sha256}`,
      input.pdf.copyPath ? `Copy kept at: ${input.pdf.copyPath}` : "A copy could not be kept; the fingerprint above identifies the exact file.",
      signed,
    ].join("\n");
  }
  return [header, "", (input.waiverText?.trim() ? input.waiverText : input.defaultText).trim(), "", signed].join("\n");
}
