import { NextResponse } from "next/server";
import { endSeries, extendSeries, pauseSeries, resumeSeries } from "@/lib/series-engine";
import { authorizeCoachCall, isResponse } from "@/lib/series-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// A 52-week schedule is booked one session at a time; give it room to finish instead of stopping part way.
export const maxDuration = 60;

// Pause, resume, end or extend a whole recurring schedule.
export async function POST(request: Request, props: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await props.params;
  const body = await request.json().catch(() => ({}));

  // The group comes from the stored schedule, never from the request, so a coach cannot act on another coach's schedule.
  const lookup = await authorizeCoachCall(await groupOfSeries(seriesId));
  if (isResponse(lookup)) return lookup;

  switch (body?.action) {
    case "pause":
      return result(await pauseSeries(lookup.store, seriesId));
    case "resume":
      return result(await resumeSeries(lookup.store, seriesId));
    case "end":
      return result(await endSeries(lookup.store, seriesId, new Date(), { cancelUpcoming: body.cancelUpcoming !== false }));
    case "extend":
      return result(await extendSeries(lookup.store, seriesId, Number(body.weeks)));
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}

function result(r: { ok: boolean; message: string }) {
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}

async function groupOfSeries(seriesId: string): Promise<string | null> {
  const { data } = await createServiceRoleClient().from("recurring_booking_series").select("group_id").eq("id", seriesId).maybeSingle();
  return data?.group_id ?? null;
}
