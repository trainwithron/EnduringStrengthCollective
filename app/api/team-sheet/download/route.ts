import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { loadSheetModel } from "@/lib/team-sheet/load-sheet";
import { buildSheetXlsx } from "@/lib/team-sheet/export-xlsx";
import { buildSheetPdf } from "@/lib/team-sheet/export-pdf";
import { DEFAULT_PER_RACK, MAX_PER_RACK, MIN_PER_RACK, isDateKey } from "@/lib/team-sheet/sheet-model";

// The team sheet download (layout B, one sheet per rack): a Day sheet or a Week sheet, as an Excel file or a printable PDF. Only a coach of the group. The sheet is built as the coach, so it holds only what they may read.
export const maxDuration = 60;

const MAX_BYTES = 4_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "Not signed in.");

  const q = new URL(request.url).searchParams;
  const groupId = q.get("groupId") ?? "";
  const mode = q.get("mode") === "week" ? "week" : q.get("mode") === "day" ? "day" : null;
  const format = q.get("format") === "pdf" ? "pdf" : q.get("format") === "xlsx" ? "xlsx" : null;
  const date = q.get("date") ?? "";
  const unit = q.get("unit") === "kg" ? "kg" : "lb";
  const perRackRaw = Number(q.get("perRack") ?? DEFAULT_PER_RACK);
  if (!UUID.test(groupId) || !mode || !format || !isDateKey(date) || !Number.isFinite(perRackRaw)) return fail(400, "Choose a Day sheet or a Week sheet, a date and a file type.");
  const perRack = Math.min(MAX_PER_RACK, Math.max(MIN_PER_RACK, Math.floor(perRackRaw)));

  // The caller must coach this group (checked as the caller, so row security decides).
  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (membershipError) return fail(502, "Couldn't check your access. Try again.");
  if (membership?.role !== "coach") return fail(403, "Only a coach of this group can make its team sheet.");

  const limited = await rateLimitResponse("team-sheet-download", user.id, 30, 3600);
  if (limited) return limited;

  const loaded = await loadSheetModel(supabase, { groupId, mode, date, perRack, unit });
  if (!loaded.ok) return fail(loaded.status, loaded.error);

  const slug = loaded.model.groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "team";
  const name = `team-sheet-${slug}-${mode === "week" ? "week-of-" : ""}${date}.${format}`;
  const body = format === "pdf" ? buildSheetPdf(loaded.model) : buildSheetXlsx(loaded.model);
  // A response over about 4.5 MB is refused by the host; the largest realistic sheet run is under 3 MB, so this only stops an extreme one with a plain message.
  if (body.length > MAX_BYTES) return fail(413, "That sheet run is too large to send in one file. Choose a Day sheet, or make it in two parts.");
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
