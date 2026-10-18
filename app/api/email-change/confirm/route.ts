import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { confirmEmailChange } from "@/lib/email-change";

// The owner of the NEW address pressed Confirm on /email-change. The token is the credential (no sign-in needed: the person may be on another device), so attempts are limited per link and per caller.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "That link is not complete." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimitResponse("email-change-confirm", `${forwarded}:${token.slice(0, 12)}`, 10, 3600);
  if (limited) return limited;

  const result = await confirmEmailChange(createServiceRoleClient(), token);
  if (result.ok) return NextResponse.json({ ok: true });
  const message: Record<string, string> = {
    invalid: "That link is not valid.",
    expired: "That link has expired. Ask your coach to send it again.",
    used: "That link was already used.",
    cancelled: "That change was cancelled.",
    taken: "That email already has an account, so nothing was changed.",
    too_soon: "This change can't be confirmed yet. A day is kept on purpose so the current address has time to object. Try again later with the same link.",
    stale: "This request is out of date (the situation changed since it was asked for), so nothing was changed. Ask your coach to start it again.",
    failed: "Couldn't change the email. Try again in a minute.",
  };
  return NextResponse.json({ error: message[result.reason] ?? message.failed, ...(result.availableAt ? { availableAt: result.availableAt } : {}) }, { status: result.reason === "failed" ? 500 : 409 });
}
