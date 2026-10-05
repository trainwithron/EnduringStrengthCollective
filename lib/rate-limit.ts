import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Per-key fixed-window limiter backed by the rate_limit_hit database function (migration 0247), so the count is
// shared across every server instance. If the database function is missing or the call fails, this falls back to a
// per-instance in-memory count rather than blocking real users: the limit is protection against abuse, never a
// reason for a normal request to fail.
const memory = new Map<string, { count: number; resetAt: number }>();

function memoryAllows(key: string, max: number, windowSeconds: number): boolean {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    if (memory.size > 5000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

export async function rateLimitAllows(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createServiceRoleClient().rpc("rate_limit_hit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (!error && typeof data === "boolean") return data;
  } catch {
    // fall through to the in-memory count
  }
  return memoryAllows(key, max, windowSeconds);
}

// The caller's address as the platform reports it. Used only to bucket abuse, never to identify anyone.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Returns a 429 response when the caller is over the limit, otherwise null.
export async function rateLimitResponse(
  scope: string,
  who: string,
  max: number,
  windowSeconds: number
): Promise<NextResponse | null> {
  const allowed = await rateLimitAllows(`${scope}:${who}`, max, windowSeconds);
  if (allowed) return null;
  return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
}
