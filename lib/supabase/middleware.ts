import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { shouldResumeClaim } from "@/lib/claim-resume";
import { SIGNED_OUT_FRAME_HTML } from "@/lib/signed-out-frame";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes the auth session cookie on every request so server components
  // always see a valid session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicPath =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname === "/beta" ||
    pathname.startsWith("/api/auth/resend-confirmation") ||
    pathname.startsWith("/api/auth/forgot-password") ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/refunds" ||
    pathname.startsWith("/api/coaches/signup") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/pr/") ||
    pathname.startsWith("/share/") ||
    // PWA files are fetched by the browser itself, often with no cookies
    // (manifest requests are credential-less by default) — redirecting them
    // to /login breaks "Add to Home Screen" and push registration.
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/apple-icon" ||
    pathname.startsWith("/icon") ||
    // guardian_links tokenized read-only view — a caregiver never has a
    // real session, same gotcha already hit for /pr/ and /share/.
    pathname.startsWith("/guardian/") ||
    pathname.startsWith("/book/") ||
    // equipment_qr_decal_scoping_sept19.md — a walk-in scanning a gym's
    // equipment decal has no account and no session, same gotcha as
    // /book/ above.
    pathname.startsWith("/scan/") ||
    // org_calendar_spotter_trainer_dispatch_scoping_sept19.md — a
    // prospect requesting a trainer, and later answering a trainer's
    // question, has no account either — same gotcha as /book/ and
    // /scan/ above. /dispatch/[stepId] is deliberately NOT included
    // here — that page is the trainer's own, and a trainer always has a
    // real account.
    pathname.startsWith("/join/") ||
    // marketplace_gather_and_browse_ui_data_investigation_sept29.md — a
    // prospect searching for a coach has no account yet either, same
    // gotcha as /book/, /join/, and /scan/ above.
    pathname.startsWith("/find-a-coach") ||
    pathname.startsWith("/dispatch-reply/") ||
    pathname.startsWith("/api/org-dispatch/submit") ||
    pathname.startsWith("/api/org-dispatch/reply") ||
    pathname.startsWith("/api/discovery-availability/") ||
    // A coach's public booking page and a visitor's private manage link: no account, the routes check and rate-limit themselves.
    pathname.startsWith("/api/public-booking/") ||
    // The discovery-call and gym QR forms post here with no login; each route validates and rate limits itself.
    pathname.startsWith("/api/public/") ||
    // Stripe calls this directly with no user session at all — its own
    // signature check is the real auth, same gotcha as /pr/ and /share/
    // above. Without this, every webhook delivery 307s to /login instead
    // of reaching the route handler, silently breaking credit/subscription
    // grants in every environment, including production.
    pathname.startsWith("/api/stripe/webhook") ||
    // Garmin's servers push device data here with no login; the route itself checks a shared secret header.
    pathname.startsWith("/api/garmin/webhook") ||
    // Twilio posts inbound texts (STOP/START/HELP) here with no session;
    // its X-Twilio-Signature check inside the route is the real auth.
    pathname.startsWith("/api/twilio/inbound") ||
    // An invite email's link establishes a real session client-side, from
    // the URL fragment — the initial server-rendered request has no
    // session cookie yet, same gotcha already hit once for /pr/ and
    // /share/.
    pathname.startsWith("/set-password") ||
    // A client's single-use claim link (and its expired-link page) is opened
    // before they have any session; the token itself is the credential.
    pathname.startsWith("/claim/") ||
    pathname.startsWith("/claim-invalid") ||
    pathname.startsWith("/confirm-email") ||
    pathname.startsWith("/forgot-password") ||
    // Vercel Cron calls these with no user session at all — the
    // CRON_SECRET bearer check inside each route is the real auth, same
    // gotcha as the Stripe webhook above. Confirmed live: without this,
    // every cron invocation (including the pre-existing /api/oura/sync)
    // 307s to /login before ever reaching the route handler, silently
    // breaking the sync/digest in every environment, including
    // production — this was a real, previously-undetected bug, not just
    // a new route needing an exemption.
    pathname.startsWith("/api/oura/sync") ||
    pathname.startsWith("/api/withings/sync") ||
    // The Google Health sync is also a daily cron (vercel.json). It checks CRON_SECRET itself; without this line it was redirected to /login and never ran.
    pathname.startsWith("/api/google-health/sync") ||
    pathname.startsWith("/api/cron/") ||
    // An uptime monitor hits this with no session at all, same gotcha as
    // the webhook/cron routes above.
    pathname.startsWith("/api/health") ||
    // Zapier's platform calls these directly with no user session at
    // all — the Bearer API-key check inside each route (lib/resolve-
    // coach-from-api-key.ts) is the real auth, same gotcha as the
    // Stripe webhook and cron routes above. /api/coach/api-key and
    // /api/webhooks/dispatch are deliberately NOT included here — both
    // are called from an already-signed-in browser session and should
    // keep requiring one.
    pathname.startsWith("/api/zapier/");

  if (!user && !isPublicPath) {
    // A workspace pane whose session has ended: the sign-in page cannot be shown in a frame, so say so and tell the main window (see lib/signed-out-frame.ts).
    if (request.headers.get("sec-fetch-dest") === "iframe") {
      return new NextResponse(SIGNED_OUT_FRAME_HTML, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Carry over any refreshed auth cookies from the response above.
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  // Pick up where a pre-set-up client left off: signed in with their claim link but never chose a password (still on the placeholder
  // address), they go back to that screen from anywhere in the app instead of landing in an account they cannot sign in to again.
  if (user && shouldResumeClaim(user.email, pathname)) {
    const resumeResponse = NextResponse.redirect(new URL("/set-password", request.url));
    response.cookies.getAll().forEach((cookie) => {
      resumeResponse.cookies.set(cookie);
    });
    return resumeResponse;
  }

  // Hard gate: a client added via the Add Client flow (profiles.intake_required)
  // who hasn't completed the PAR-Q+/waiver intake yet cannot reach any
  // /groups/** page — catches a direct URL visit, not just the one-time
  // post-signup redirect in app/set-password/page.tsx. Scoped to /groups
  // only so /intake itself, /login, /set-password, etc. never loop.
  // Existing accounts (intake_required defaults false) are never touched.
  if (user && pathname.startsWith("/groups")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("intake_required")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.intake_required) {
      const { data: intake } = await supabase
        .from("client_intake")
        .select("completed_at")
        .eq("athlete_id", user.id)
        .maybeSingle();

      if (!intake?.completed_at) {
        const redirectUrl = new URL("/intake", request.url);
        const redirectResponse = NextResponse.redirect(redirectUrl);
        response.cookies.getAll().forEach((cookie) => {
          redirectResponse.cookies.set(cookie);
        });
        return redirectResponse;
      }
    }
  }

  return response;
}
