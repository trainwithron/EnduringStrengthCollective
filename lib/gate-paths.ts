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
  // The claim step: a coach-added client sets their password here BEFORE they have any birthday on file. A teen waiting for a guardian setting a password is harmless.
  "/api/clients/complete-claim",
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
  // A prefix ending in a slash covers everything below it; any other entry is that exact path or something below it (so "/api/feedbackx" and "/api/healthz" are NOT exempt).
  return !API_GATE_EXEMPT_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")));
}

// What the middleware does with a person at a gate. The page gate sends everyone who is not "ok" to /birthday. The API gate exists to stop KNOWN minors (under 13, 13 to 17 without a standing signature) and failed checks: a person whose
// birthday is simply not entered yet (need_dob) is let through on the API (the page gate already sends them to /birthday), or the claim step and other pre-birthday calls would dead-end.
export type GateAction = "pass" | "redirect_birthday" | "forbidden" | "unavailable";
export function gateAction(input: { kind: "page" | "api"; gate: "ok" | "need_dob" | "blocked" | "need_guardian" | "check_failed"; onIntake?: boolean }): GateAction {
  const { kind, gate } = input;
  if (gate === "ok") return "pass";
  if (kind === "api") return gate === "need_dob" ? "pass" : gate === "check_failed" ? "unavailable" : "forbidden";
  // The health form is reached before a date of birth is on file (it asks for one).
  if (input.onIntake && gate === "need_dob") return "pass";
  return "redirect_birthday";
}

// The intake gate (a client added by a coach who has not finished the health form) is only for a person who is a client and nothing else: an athlete seat and no coach seat. A coach who is also someone's client
// is never walled out of their coach pages by it (they used to loop between /intake and / with no way out).
export function intakeGateApplies(seats: { role: string }[]): boolean {
  return seats.some((s) => s.role === "athlete") && !seats.some((s) => s.role === "coach");
}
