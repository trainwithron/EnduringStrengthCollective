import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey } from "@/lib/timezone";

// A progress photo added from the weekly check-in: the same private bucket, path, row and limits as the progress photo journal (components/athlete/progress-photo-journal.tsx), so
// it is one of the client's own progress photos and shows in their journal too. The one difference is that it is shared with the coach, because the client is sending it to them.
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

export function photoProblem(file: { type: string; size: number }): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return "Use a JPEG, PNG, WebP, or HEIC photo.";
  if (file.size > PHOTO_MAX_BYTES) return "That photo is too large (15MB max).";
  return null;
}

export async function uploadCheckinPhoto(
  supabase: SupabaseClient,
  { athleteId, groupId, file }: { athleteId: string; groupId: string; file: File }
): Promise<{ ok: true; id: string; previewUrl: string } | { ok: false; error: string }> {
  const problem = photoProblem(file);
  if (problem) return { ok: false, error: problem };
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${athleteId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("progress-photos").upload(path, file);
  if (uploadError) return { ok: false, error: "Couldn't upload that photo. Try again." };
  const { data, error } = await supabase
    .from("progress_photos")
    .insert({ athlete_id: athleteId, group_id: groupId, storage_path: path, taken_date: localDateKey(), shared_with_coach: true })
    .select("id")
    .single();
  if (error || !data) {
    // no row to show it by: the file goes too
    await supabase.storage.from("progress-photos").remove([path]);
    return { ok: false, error: "Couldn't save that photo. Try again." };
  }
  return { ok: true, id: (data as { id: string }).id, previewUrl: URL.createObjectURL(file) };
}
