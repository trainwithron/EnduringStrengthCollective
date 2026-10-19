import { isPlaceholderEmail } from "@/lib/placeholder-email";

// ONE rule for "this person has signed in, so the account is theirs now" (Oct 19 audit item 17). A client is claimed when the claim step stamped them, or when they have a sign-in on record AND a real email address.
// Someone who opened the claim link but never finished choosing a password has a sign-in time but no real address and was never claimed: they still need a sign-in link from their coach. The coach's "Send the link" and
// "Email the link" buttons and the Resend button all use this same rule, so they can never disagree about the same client.
export function everSignedIn(input: { claimedAt: string | null | undefined; lastSignInAt: string | null | undefined; email: string | null | undefined }): boolean {
  if (input.claimedAt) return true;
  const hasRealEmail = !!input.email && !isPlaceholderEmail(input.email);
  return !!input.lastSignInAt && hasRealEmail;
}
