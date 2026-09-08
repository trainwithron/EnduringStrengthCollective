import Stripe from "stripe";

// Server-only Stripe client — never import into a client component. Same
// "missing key degrades gracefully" pattern as lib/anthropic-client.ts:
// the app runs fine with no Stripe env vars set, checkout/subscribe
// buttons just return a clear "not configured" message instead of
// crashing.
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  if (!stripeClient) {
    // No pinned apiVersion — uses the account's own default API version
    // rather than a hardcoded string that would drift out of sync with
    // whatever the installed SDK's types expect as new API versions ship.
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}
