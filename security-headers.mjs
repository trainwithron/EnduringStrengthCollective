// Security headers for every response, built in one place so they can be tested (security-headers.test.ts) and read in one piece.
//
// What the content security policy allows, and why:
//   * Scripts: this site only. Next.js writes small inline scripts to start each page, so 'unsafe-inline' is needed (a per-request
//     nonce would be stronger and is a good later step). 'unsafe-eval' is added in development only (hot reload needs it).
//   * Styles: this site, inline styles (Tailwind and Next.js use them) and Google Fonts.
//   * Fonts: this site, Google Fonts files, data URIs.
//   * Images and media: this site, data/blob URIs and any https source: coaches paste logo, link-preview and exercise images
//     from anywhere, and uploaded photos and videos come from Supabase storage.
//   * Network calls from the browser: this site, Supabase (data, storage and realtime websockets) and Daily (video calls).
//     Everything else (Stripe, Twilio, Brevo, Anthropic, Google, Oura...) is called from the server, not the browser.
//   * Frames: YouTube (exercise videos) and Daily (video calls) only. Nobody may frame this site (frame-ancestors 'none'), EXCEPT the coach's own pages
//     (/groups/..., /clients, /dashboard), which the site itself may frame so the workspace can show one coach page inside another (frame-ancestors 'self',
//     X-Frame-Options SAMEORIGIN, and 'self' added to frame-src). Another site can still never frame any page.
//   * Forms may only post to this site; no plugins; no <base> tricks.
// The camera and microphone are deliberately NOT mentioned in Permissions-Policy: listing them as (self) would also stop the
// Daily call frame from using them. Sensors, payment, USB and the rest are turned off.

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildSecurityHeaders({ isProd, supabaseUrl, embeddable = false }) {
  const supabaseOrigin = origin(supabaseUrl || "") || "https://*.supabase.co";
  const supabaseWs = supabaseOrigin.replace(/^https:/, "wss:");

  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isProd ? [] : ["'unsafe-eval'"])],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", supabaseOrigin, supabaseWs, "https://*.daily.co", "wss://*.daily.co", ...(isProd ? [] : ["ws:", "http://localhost:*"])],
    "frame-src": [...(embeddable ? ["'self'"] : []), "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://*.daily.co"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": [embeddable ? "'self'" : "'none'"],
  };
  const csp = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .concat(isProd ? ["upgrade-insecure-requests"] : [])
    .join("; ");

  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: embeddable ? "SAMEORIGIN" : "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: ["accelerometer=()", "bluetooth=()", "geolocation=()", "gyroscope=()", "magnetometer=()", "payment=()", "usb=()", "interest-cohort=()"].join(", "),
    },
  ];
  // Only over real https, so local development over http is never told to remember https.
  if (isProd) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}
