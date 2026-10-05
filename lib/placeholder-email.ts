// The address a client the coach set up before they ever signed in sits on until they claim the account and give their real one. It can never
// receive mail. Kept free of any server-only imports so the edge middleware can use it.
export const PLACEHOLDER_EMAIL_DOMAIN = "pending.invalid";

export function placeholderEmailFor(seed: string): string {
  return `client-${seed.replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
