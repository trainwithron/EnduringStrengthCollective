// The person's own photo, video and voice note files in "Download my data" (Ron, Nov 20, S5): the export listed the photo and InBody rows but not the pictures themselves. Each file is given as a
// download link that works for 7 days, made under the person's own sign-in (storage's own rules decide what they may read; a file they can't read is left out and counted).
export const EXPORT_FILE_LINK_SECONDS = 7 * 24 * 3600;

// owner: the column that names the person (the voice notes they sent: R7, Ron Nov 20).
export const SOURCES = [
  { kind: "progress_photo", bucket: "progress-photos", table: "progress_photos", column: "storage_path", owner: "athlete_id" },
  { kind: "inbody_scan_photo", bucket: "inbody-scans", table: "body_scans", column: "photo_path", owner: "athlete_id" },
  { kind: "form_check_video", bucket: "athlete-exercise-videos", table: "session_exercise_videos", column: "video_path", owner: "athlete_id" },
  { kind: "voice_note", bucket: "voice-notes", table: "direct_messages", column: "voice_path", owner: "sender_id" },
] as const;

// A column a database update has not added yet (the voice notes before migration 0464): nothing of that kind exists, so nothing is missing.
const NOT_THERE_YET = "42703";

export interface ExportFile {
  kind: (typeof SOURCES)[number]["kind"];
  path: string;
  downloadUrl: string;
}

type Client = {
  from: (t: string) => any;
  storage: { from: (b: string) => { createSignedUrls: (paths: string[], seconds: number) => Promise<{ data: { path: string | null; signedUrl: string | null }[] | null; error: unknown }> } };
};

export async function collectExportFiles(supabase: Client, userId: string): Promise<{ files: ExportFile[]; notIncluded: number }> {
  const files: ExportFile[] = [];
  let notIncluded = 0;
  for (const s of SOURCES) {
    const { data, error } = await supabase.from(s.table).select(s.column).eq(s.owner, userId).not(s.column, "is", null).limit(2000);
    if (error && (error as { code?: string }).code === NOT_THERE_YET) continue;
    // a list that could not be read is counted as not included (the note then says to download again)
    if (error) {
      notIncluded++;
      continue;
    }
    const paths = [...new Set(((data ?? []) as Record<string, string | null>[]).map((r) => r[s.column]).filter((p): p is string => !!p))];
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      const { data: signed } = await supabase.storage.from(s.bucket).createSignedUrls(chunk, EXPORT_FILE_LINK_SECONDS);
      const byPath = new Map((signed ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path as string, d.signedUrl as string]));
      for (const p of chunk) {
        const url = byPath.get(p);
        if (url) files.push({ kind: s.kind, path: p, downloadUrl: url });
        else notIncluded++;
      }
    }
  }
  return { files, notIncluded };
}
