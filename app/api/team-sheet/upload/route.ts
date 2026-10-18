import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { fail, requireCoach, UUID } from "@/lib/team-sheet/coach-access";
import { MAX_UPLOAD_BYTES, readUpload } from "@/lib/team-sheet/read-upload";
import { buildReview, loadContext } from "@/lib/team-sheet/review";

// Reading a filled team sheet (an Excel file or a CSV) for the review screen. Nothing is saved here and nothing is written: the file is read, checked against what the group has now, and shown back to the coach.
// Only a coach of the group. The file is read as text; no formula in it is ever run.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Choose a file to upload.");
  }
  const groupId = String(form.get("groupId") ?? "");
  const unit = form.get("unit") === "kg" ? "kg" : "lb";
  const file = form.get("file");
  const access = await requireCoach(supabase, groupId);
  if (!access.ok) return access.response;
  if (!(file instanceof File)) return fail(400, "Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "That file is too large. A team sheet is well under 5 MB.");

  const limited = await rateLimitResponse("team-sheet-upload", access.userId, 30, 3600);
  if (limited) return limited;

  const read = readUpload(Buffer.from(await file.arrayBuffer()), file.name || "");
  if (!read.ok) return fail(422, read.error);
  if (read.racks.some((r) => r.code.groupId !== groupId || !UUID.test(r.code.groupId))) return fail(422, "That file is for a different group. Upload it from that group's Team sheet page.");

  const loaded = await loadContext(supabase, groupId, read.racks);
  if (!loaded.ok) return fail(502, loaded.error);
  // the unit on the sheet is the unit it was printed in; a sheet printed in kg is read in kg whatever the form says
  const sheetUnit = read.racks[0].code.unit ?? unit;
  const review = buildReview(groupId, read.racks, loaded.context, sheetUnit);
  return NextResponse.json({ review, source: read.source }, { headers: { "Cache-Control": "no-store" } });
}
