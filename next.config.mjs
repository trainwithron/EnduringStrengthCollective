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
    ];
  },
};

export default nextConfig;
