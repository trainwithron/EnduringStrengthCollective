import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cancelEmailChange } from "@/lib/email-change";

// The old address (or the person it belongs to) pressed Cancel on /email-change: the waiting change is dropped and nothing about the account changes. The token is the credential.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "That link is not complete." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimitResponse("email-change-cancel", `${forwarded}:${token.slice(0, 12)}`, 10, 3600);
  if (limited) return limited;

  const result = await cancelEmailChange(createServiceRoleClient(), token);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That change can no longer be cancelled (it was already confirmed, or the link is not valid)." }, { status: 409 });
}
