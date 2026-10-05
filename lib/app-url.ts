// The one canonical address of the app, for anything that leaves it: invite and claim links, Stripe return pages,
// confirmation redirects, equipment QR decals. Set NEXT_PUBLIC_APP_URL (for example https://app.example.com) in the
// hosting environment. Without it this falls back to the address the request came in on, which works for ordinary
// use but is wrong for printed things (a decal printed from a preview address is broken for good) and trusts a header
// the caller controls.
export function configuredAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function appOrigin(request: Request): string {
  return configuredAppUrl() ?? request.headers.get("origin") ?? new URL(request.url).origin;
}

// Browser side: the configured address when there is one (so a link a coach copies or a QR code they print points at
// the real app, whichever address they happen to be using right now), else the current address.
export function appOriginBrowser(): string {
  return configuredAppUrl() ?? (typeof window !== "undefined" ? window.location.origin : "");
}
