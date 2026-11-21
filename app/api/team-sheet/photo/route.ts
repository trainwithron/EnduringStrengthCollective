import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { AiNotConfiguredError, AiTimeoutError, AiTruncatedError, callClaude, extractJson, isAiConfigured, MAX_IMAGE_BASE64_CHARS } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { fail, requireCoach } from "@/lib/team-sheet/coach-access";
import { decodeSheetCode, type SheetCode } from "@/lib/team-sheet/sheet-code";
import type { ParsedRack } from "@/lib/team-sheet/read-upload";
import { buildReview, commonUnit, loadContext } from "@/lib/team-sheet/review";
import { MAX_PHOTOS, mergeRacks, parsePhotoReading, photoUserText, rackFromPhoto, TEAM_SHEET_PHOTO_PROMPT } from "@/lib/team-sheet/photo-read";

// Reading photos of a filled-in PRINTED team sheet for the same review screen an uploaded file gets. Nothing is saved here and nothing is written; the photos are read and dropped, never stored.
// Which sheet each photo is comes from its printed QR sheet code, decoded in the coach's browser and checked here (lib/team-sheet/sheet-code.ts); the model only copies what is written in the
// boxes (lib/team-sheet/photo-read.ts). Only a coach of the group. The AI allowance, its caps and the burst limit are enforced inside callClaude (feature "team_sheet_photo").
export const maxDuration = 120;

const NOT_ON = "Reading a sheet from a photo isn't available yet. Upload the Excel file or a CSV instead.";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
// MAX_PHOTOS images at the largest size one model call takes, plus the codes: anything bigger is not a request this page sends
const MAX_BODY_CHARS = MAX_PHOTOS * (MAX_IMAGE_BASE64_CHARS + 4_000) + 10_000;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return fail(413, "Those photos are too large. Take them again (the page shrinks a photo before it is sent).");
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "That request could not be read.");
  }
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const access = await requireCoach(supabase, groupId);
  if (!access.ok) return access.response;

  const photos: unknown[] = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length === 0) return fail(400, "Take a photo of the filled-in sheet.");
  if (photos.length > MAX_PHOTOS) return fail(400, `Up to ${MAX_PHOTOS} photos at a time.`);
  const pages: { code: SheetCode; imageBase64: string; mediaType: string }[] = [];
  for (const p of photos as { imageBase64?: unknown; mediaType?: unknown; codeText?: unknown }[]) {
    const imageBase64 = typeof p?.imageBase64 === "string" ? p.imageBase64 : "";
    const mediaType = typeof p?.mediaType === "string" ? p.mediaType : "";
    if (!imageBase64) return fail(400, "A photo in this request is empty.");
    if (!ALLOWED_TYPES.includes(mediaType)) return fail(400, "Use a JPEG, PNG or WebP photo.");
    if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) return fail(413, "A photo is too large. Take it again (the page shrinks a photo before it is sent).");
    const decoded = decodeSheetCode(p?.codeText);
    if (!decoded.ok) return fail(422, `${decoded.reason} Take the photo again with the sheet code (the square in the bottom right corner) in view.`);
    if (decoded.code.groupId !== groupId) return fail(422, "A photo is of a sheet for a different group. Read it from that group's Team sheet page.");
    pages.push({ code: decoded.code, imageBase64, mediaType });
  }

  if (!isAiConfigured()) return fail(503, NOT_ON);
  const limited = await rateLimitResponse("team-sheet-photo", access.userId, 20, 3600);
  if (limited) return limited;

  const loaded = await loadContext(supabase, groupId, pages);
  if (!loaded.ok) return fail(502, loaded.error);
  const sheetUnit = commonUnit(pages);
  if (!sheetUnit) return fail(422, "These sheets were printed in different units (lb and kg). Read them from one Team sheet page at a time.");
  // the names as printed on the sheet (lib/team-sheet/load-sheet.ts: the display name, else the exercise name)
  const names = new Map<string, string>();
  for (const [id, e] of loaded.context.exercises) names.set(id, (e.display_name ?? "").trim() || e.exercise_name);

  const racks: ParsedRack[] = [];
  let unclear = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const which = pages.length > 1 ? `Photo ${i + 1}: ` : "";
    let raw: string;
    try {
      raw = await callClaude({
        meta: { feature: "team_sheet_photo", userId: access.userId },
        system: TEAM_SHEET_PHOTO_PROMPT,
        userText: photoUserText(page.code, names),
        image: { mediaType: page.mediaType as "image/jpeg" | "image/png" | "image/webp", base64Data: page.imageBase64 },
        // a page holds at most 12 rows and 12 exercise columns (lib/team-sheet/sheet-model.ts), each box a few tokens
        maxTokens: 10000,
      });
    } catch (err) {
      if (err instanceof AiRateLimitedError) return fail(429, err.message);
      if (err instanceof AiNotConfiguredError) return fail(503, NOT_ON);
      if (err instanceof AiTimeoutError || err instanceof AiTruncatedError) return fail(504, `${which}Reading that photo took too long. Take one photo per printed page and try again.`);
      console.error("team-sheet photo read failed", { groupId, photo: i, message: err instanceof Error ? err.message : String(err) });
      return fail(502, `${which}Couldn't read the photo. Try again, or upload the Excel file instead.`);
    }
    let json: unknown;
    try {
      json = JSON.parse(extractJson(raw));
    } catch {
      return fail(422, `${which}The photo could not be read as a team sheet. Take it again with the whole page flat and in view.`);
    }
    const parsed = parsePhotoReading(json);
    if (!parsed.ok) return fail(422, `${which}${parsed.error}`);
    const rack = rackFromPhoto(page.code, names, parsed.reading);
    if (!rack.ok) return fail(422, `${which}${rack.error}`);
    racks.push(rack.rack);
    unclear += rack.unclear;
  }

  const review = buildReview(groupId, mergeRacks(racks), loaded.context, sheetUnit);
  return NextResponse.json({ review, source: "photo", unclear }, { headers: { "Cache-Control": "no-store" } });
}
