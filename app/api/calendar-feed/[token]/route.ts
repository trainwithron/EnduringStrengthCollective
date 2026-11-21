import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { limitByIp } from "@/lib/public-booking-route";
import { rateLimitAllows } from "@/lib/rate-limit";
import { pageAll } from "@/lib/page-all";
import { buildIcs, FEED_FUTURE_DAYS, FEED_PAST_DAYS, FEED_TOKEN_PATTERN, type FeedEvent } from "@/lib/ical-feed";

// A coach's private calendar feed (Ron, Nov 20, wave 3 C8), read by their calendar app: /api/calendar-feed/<secret>.ics. No sign-in (a calendar app cannot sign in): the long
// random secret in the address is the key, and "Make a new link" or "Turn off" in Settings ends it. Read only. The coach's confirmed sessions and calls from 60 days back to a
// year ahead, each with the person's first name only (lib/ical-feed.ts). A wrong or old secret gets a plain 404 with nothing in it.
export const dynamic = "force-dynamic";

const TRY_LATER = () => new NextResponse("Try again later", { status: 503, headers: { "Retry-After": "600", "Cache-Control": "no-store" } });
const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token: raw } = await props.params;
  const token = (raw ?? "").replace(/\.ics$/i, "").toLowerCase();
  if (!FEED_TOKEN_PATTERN.test(token)) return NOT_FOUND();
  // calendar apps check every few minutes to hours; this is generous for that and stops guessing
  const limited = await limitByIp(request, "calendar-feed-ip", 120, 3600);
  if (limited) return limited;
  if (!(await rateLimitAllows(`calendar-feed:${token.slice(0, 16)}`, 120, 3600))) return new NextResponse("Too many requests", { status: 429 });

  const db = createServiceRoleClient();
  const { data: feed, error: feedError } = await db.from("coach_calendar_feeds").select("coach_id").eq("token", token).maybeSingle();
  if (feedError) return TRY_LATER();
  const coachId = (feed as { coach_id?: string } | null)?.coach_id;
  if (!coachId) return NOT_FOUND();

  const from = new Date(Date.now() - FEED_PAST_DAYS * 86400000).toISOString();
  const to = new Date(Date.now() + FEED_FUTURE_DAYS * 86400000).toISOString();
  // read a page at a time (PostgREST stops at 1000 rows a request); a failed or cut-off read is an error the calendar app retries, never an empty or partial calendar
  // (that would wipe the coach's events from it)
  const [sessions, calls] = await Promise.all([
    pageAll((a, b) =>
      db
        .from("bookings")
        .select("id, start_at, end_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", coachId)
        .eq("status", "confirmed")
        .gte("start_at", from)
        .lte("start_at", to)
        .order("id")
        .range(a, b)
    ),
    pageAll((a, b) => db.from("discovery_bookings").select("id, start_at, end_at, prospect_name").eq("coach_id", coachId).eq("status", "confirmed").gte("start_at", from).lte("start_at", to).order("id").range(a, b)),
  ]);
  if (sessions.failed || sessions.truncated || calls.failed || calls.truncated) return TRY_LATER();

  const events: FeedEvent[] = [
    ...(sessions.rows as any[]).map((b) => ({ id: String(b.id), kind: "session" as const, startAt: b.start_at, endAt: b.end_at, name: (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles)?.full_name ?? null })),
    ...(calls.rows as any[]).map((c) => ({ id: String(c.id), kind: "call" as const, startAt: c.start_at, endAt: c.end_at, name: c.prospect_name ?? null })),
  ];
  return new NextResponse(buildIcs(events, "Spotlight sessions"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="spotlight.ics"', "Cache-Control": "private, max-age=300" },
  });
}
