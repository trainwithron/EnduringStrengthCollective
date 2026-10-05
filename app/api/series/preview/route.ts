import { NextResponse } from "next/server";
import { previewSeries } from "@/lib/series-engine";
import { athleteIsInGroup, authorizeCoachCall, isResponse, parseSeriesInput } from "@/lib/series-route";

// What a recurring schedule would book, and which dates clash with something. Writes nothing.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const call = await authorizeCoachCall(body?.groupId);
  if (isResponse(call)) return call;

  const input = parseSeriesInput(body, call.userId);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!(await athleteIsInGroup(call.db, input.athleteId, input.groupId))) {
    return NextResponse.json({ error: "That client is not in this group." }, { status: 400 });
  }
  return NextResponse.json(await previewSeries(call.store, input));
}
