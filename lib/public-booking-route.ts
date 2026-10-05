import { NextResponse } from "next/server";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicBookingStore } from "@/lib/public-booking-store";

// Shared by the public booking routes. These are reachable by anyone, so each one limits how often a single address can call it
// and caps the size of what it accepts. Nothing here trusts the browser: the engine re-checks every time against the coach's
// real calendar.
export function publicStore() {
  return publicBookingStore(createServiceRoleClient());
}

export async function limitByIp(request: Request, scope: string, max: number, windowSeconds: number): Promise<NextResponse | null> {
  const ok = await rateLimitAllows(`${scope}:${clientIp(request)}`, max, windowSeconds);
  return ok ? null : NextResponse.json({ error: "Too many requests. Please try again in a little while." }, { status: 429 });
}

export function cleanParam(value: string | undefined, max: number): string | null {
  if (!value || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}
