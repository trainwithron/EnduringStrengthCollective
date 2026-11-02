import { buildSecurityHeaders } from "./security-headers.mjs";

// The pages this site may show inside its own frames (the workspace panes and the split screen): every coach page, and the public page.
const EMBEDDABLE_PATHS = ["/groups/:path*", "/clients/:path*", "/dashboard/:path*", "/calendar/:path*", "/group-calendar/:path*", "/programs/:path*", "/recurring-conflicts/:path*", "/running-low/:path*", "/c/:path*"];

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
      // The public page (/c/...) too, so My website can show it beside the editor (Ron, Oct 31). Still this site only: no other site can frame it.
      // Every coach page outside a group too (Nov 2: the split screen's Program tile opens /programs, which was missing here, so the browser refused to show it). security-headers.test.ts checks each app/(coach) folder is listed.
      ...EMBEDDABLE_PATHS.map((source) => ({
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
