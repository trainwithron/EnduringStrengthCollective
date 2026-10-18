import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { getGroupCoachTimezone } from "@/lib/timezone";
import { fail, requireCoach } from "@/lib/team-sheet/coach-access";
import { decodeSheetCode } from "@/lib/team-sheet/sheet-code";
import type { ParsedRack } from "@/lib/team-sheet/read-upload";
import { buildReview, commonUnit, loadContext, toSaveRows } from "@/lib/team-sheet/review";
import { savePiece } from "@/lib/team-sheet/save-pieces";

// Saving a reviewed team sheet. The browser sends back only the sheet codes and the TEXT of each box as the coach left it; everything else (which athlete, which exercise, which workout, what each box means) is worked out
// again here from the codes and the database, so what is saved is never what a browser says it understood. A box the reader is not sure of saves nothing. The database function does the writing, as the coach.
export const maxDuration = 300;

const MAX_BODY_BYTES = 600_000;
const MAX_CELL = 120;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return fail(400, "That request is empty or too large.");
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "That request could not be read.");
  }
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const access = await requireCoach(supabase, groupId);
  if (!access.ok) return access.response;
  const source = body.source === "csv" ? "csv" : body.source === "photo" ? "photo" : "xlsx";
  const replace = body.replace === true;
  const sheets: unknown[] = Array.isArray(body.sheets) ? body.sheets : [];
  if (sheets.length === 0 || sheets.length > 60) return fail(400, "There is nothing to save.");

  const racks: ParsedRack[] = [];
  const skip = new Set<string>();
  const seen = new Set<number>();
  for (const s of sheets as { code?: unknown; rows?: unknown }[]) {
    const decoded = decodeSheetCode(s?.code);
    if (!decoded.ok) return fail(422, decoded.reason);
    const { code } = decoded;
    if (code.groupId !== groupId) return fail(422, "A sheet in this request is for a different group.");
    if (seen.has(code.rack)) return fail(422, `Rack ${code.rack} is in the request twice.`);
    seen.add(code.rack);
    const rows = Array.isArray(s.rows) ? (s.rows as { athleteId?: unknown; skip?: unknown; cells?: unknown }[]) : [];
    if (rows.length !== code.athletes.length) return fail(422, `Rack ${code.rack} does not match its sheet code.`);
    const parsedRows: ParsedRack["rows"] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row?.athleteId !== code.athletes[i]) return fail(422, `Rack ${code.rack} does not match its sheet code.`);
      const cells = Array.isArray(row.cells) ? (row.cells as unknown[]) : [];
      if (cells.length !== code.days.length) return fail(422, `Rack ${code.rack} does not match its sheet code.`);
      const days: string[][] = [];
      for (let d = 0; d < code.days.length; d++) {
        const dayCells = Array.isArray(cells[d]) ? (cells[d] as unknown[]) : [];
        if (dayCells.length !== code.days[d].exercises.length) return fail(422, `Rack ${code.rack} does not match its sheet code.`);
        days.push(dayCells.map((c) => String(c ?? "").slice(0, MAX_CELL)));
      }
      parsedRows.push({ athleteId: code.athletes[i], printedName: "", cells: days, notes: "" });
      if (row.skip === true) skip.add(`${code.rack}:${code.athletes[i]}`);
    }
    racks.push({ code, rows: parsedRows });
  }

  const limited = await rateLimitResponse("team-sheet-save", access.userId, 30, 3600);
  if (limited) return limited;

  const loaded = await loadContext(supabase, groupId, racks);
  if (!loaded.ok) return fail(502, loaded.error);
  const unit = commonUnit(racks);
  if (!unit) return fail(422, "The sheets in this request were printed in different units (lb and kg).");
  const review = buildReview(groupId, racks, loaded.context, unit);
  const timeZone = await getGroupCoachTimezone(supabase, groupId);
  const { rows, droppedUnsure } = toSaveRows(review, timeZone, skip);
  if (rows.length === 0) return fail(422, "There is nothing to save: every box is empty, skipped, or one the reader was not sure of.", { droppedUnsure });
  if (rows.length > 2000) return fail(422, "That is more than one upload can carry (2,000 workouts). Save it in two parts.");

  // sent in pieces so no single database call is long; the first starts the upload, the others add to it, and the last writes the one notice. Earliest day first, so a record set on Monday is in place before Wednesday's.
  rows.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.athlete_id < y.athlete_id ? -1 : 1));
  const piece = savePiece();
  let batch: string | null = null;
  let saved = 0;
  let kept = 0;
  let replaced = 0;
  let records = 0;
  const skipped: unknown[] = [];
  for (let i = 0; i < rows.length; i += piece) {
    const last = i + piece >= rows.length;
    const { data, error } = await supabase.rpc("team_sheet_save", { p_group: groupId, p_source: source, p_rows: rows.slice(i, i + piece), p_replace: replace, p_batch: batch, p_last: last });
    if (error) {
      console.error("team-sheet save failed", { groupId, piece: i / piece, message: error.message });
      if (batch === null) {
        if (/not authorized/i.test(error.message)) return fail(403, "Only a coach of this group can save a team sheet.");
        return fail(502, "Couldn't save the team sheet. Nothing was saved. Try again.");
      }
      // some pieces were saved: close the upload (one notice, one undo) and say exactly what happened
      await supabase.rpc("team_sheet_save", { p_group: groupId, p_source: source, p_rows: [], p_replace: replace, p_batch: batch, p_last: true });
      return NextResponse.json(
        { batch, saved, kept, replaced, records, skipped, droppedUnsure, partial: true, notSaved: rows.length - i },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const r = data as { batch: string | null; saved: number; kept: number; replaced: number; records: number; skipped: unknown[] };
    batch = r.batch ?? batch;
    saved += r.saved ?? 0;
    kept += r.kept ?? 0;
    replaced += r.replaced ?? 0;
    records = r.records ?? records;
    skipped.push(...(r.skipped ?? []));
  }
  return NextResponse.json({ batch: saved > 0 ? batch : null, saved, kept, replaced, records, skipped, droppedUnsure }, { headers: { "Cache-Control": "no-store" } });
}
