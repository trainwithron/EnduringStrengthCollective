import { buildSecurityHeaders } from "./security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The default 30s client-side router cache means switching feed
    // channel tabs (or anything else navigated by searchParams) can show
    // a stale snapshot from up to 30 seconds ago instead of a fresh
    // server render — wrong for a live team feed. Disabling it for
    // dynamic segments means every navigation actually re-fetches.
    staleTimes: {
      dynamic: 0,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          isProd: process.env.NODE_ENV === "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
      // The coach's own pages may be shown inside the workspace (framed by this site only): see security-headers.mjs. Listed after the rule above so these values win.
      ...["/groups/:path*", "/clients", "/dashboard"].map((source) => ({
        source,
        headers: buildSecurityHeaders({
          isProd: process.env.NODE_ENV === "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          embeddable: true,
        }),
      })),
      // The email-link landing pages: a ?code or token_hash in the address must never be sent on in a Referer header.
      { source: "/set-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/confirm-email", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
