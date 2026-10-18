// Which paths the age and consent gate (lib/dob-gate.ts) and the intake gate cover. Pure, so the lists can be tested.

// Pages a client uses. A blocked or not-yet-permitted child is sent to /birthday from any of them. (/intake is handled separately: it is reached before a date of birth is on file.)
export const DOB_GATED_PAGE_PREFIXES = ["/groups", "/sessions", "/my-training", "/my-space", "/partners", "/notifications", "/your-coaches", "/dashboard"] as const;

export function dobGatedPage(pathname: string): boolean {
  return DOB_GATED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// API routes a child must still be able to reach while blocked: their own data download and deletion, the guardian's signing, the birthday/intake step itself, the legal acceptance and status, sign-in help, support feedback, and
// turning push notifications OFF. Everything else under /api is closed to a blocked child by the middleware (one shared guard, so a new route is covered without anyone remembering to add it).
// Public and machine-to-machine routes (cron, webhooks, public booking, the uptime check) never reach this: they have no session.
export const API_GATE_EXEMPT_PREFIXES = [
  "/api/account/",
  "/api/guardian-consent/",
  "/api/intake/",
  "/api/legal/",
  "/api/auth/",
  "/api/email-change/",
  "/api/feedback",
  "/api/push/unsubscribe",
  "/api/health",
  "/api/cron/",
  "/api/stripe/webhook",
  "/api/twilio/",
  "/api/garmin/webhook",
  "/api/zapier/",
  "/api/public/",
  "/api/public-booking/",
  "/api/demo-thumb/",
  "/api/discovery-availability/",
] as const;

export function apiGateApplies(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  return !API_GATE_EXEMPT_PREFIXES.some((p) => (p.endsWith("/") || p === "/api/feedback" || p === "/api/health" ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")));
}

// The intake gate (a client added by a coach who has not finished the health form) is only for a person who is a client and nothing else: an athlete seat and no coach seat. A coach who is also someone's client
// is never walled out of their coach pages by it (they used to loop between /intake and / with no way out).
export function intakeGateApplies(seats: { role: string }[]): boolean {
  return seats.some((s) => s.role === "athlete") && !seats.some((s) => s.role === "coach");
}
