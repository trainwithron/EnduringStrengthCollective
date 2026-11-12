// Adding an exercise demo from a phone (Ron, Nov 12: "I record them on my phone"; "lets do a 30 second limit at 4k"). A demo is up to 30 seconds long; 30 seconds of 4K from a phone is
// roughly 180 MB at 30 frames a second and 300 MB at 60, so the size limit (storage.buckets "exercise-media", step 203) is 350 MB.

import { Upload } from "tus-js-client";

export const DEMO_MAX_SECONDS = 30;
export const DEMO_MAX_BYTES = 350 * 1024 * 1024;
// A phone's "30 second" clip often runs a few frames over.
const DURATION_SLACK_SECONDS = 1;

const BY_EXTENSION: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", qt: "video/quicktime", webm: "video/webm" };
const ALLOWED = new Set(["video/mp4", "video/quicktime", "video/webm"]);

/** The type the bucket will accept for this file, or null. Some phone browsers hand over no type at all, so the file's ending decides then. */
export function demoContentType(file: { type: string; name: string }): string | null {
  if (ALLOWED.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

export function demoExtension(contentType: string): string {
  return contentType === "video/quicktime" ? "mov" : contentType === "video/webm" ? "webm" : "mp4";
}

/** What to say when a file can't be used, or null when it can. `seconds` is the video's length when the browser could read it (null when it couldn't: the size limit still applies). */
export function demoFileProblem(file: { type: string; name: string; size: number }, seconds: number | null = null): string | null {
  if (!demoContentType(file)) return "Use an MP4, MOV or WebM video.";
  if (seconds != null && Number.isFinite(seconds) && seconds > DEMO_MAX_SECONDS + DURATION_SLACK_SECONDS) {
    return `That video is ${Math.round(seconds)} seconds long. Demos can be up to ${DEMO_MAX_SECONDS} seconds: trim it in your phone's gallery, then pick it again.`;
  }
  if (file.size > DEMO_MAX_BYTES) {
    return `That video is ${Math.round(file.size / 1048576)} MB and the limit is 350 MB (30 seconds of 4K). Trim it shorter, then pick it again.`;
  }
  return null;
}

/**
 * Uploads one video to storage in 6 MB pieces, reporting progress (0 to 1). If the signal drops, it keeps retrying, and trying the same video again later carries on from the last piece
 * that arrived instead of starting over (Supabase's resumable upload; 6 MB is the piece size it requires).
 */
export function uploadDemo({
  supabaseUrl,
  anonKey,
  accessToken,
  path,
  file,
  contentType,
  onProgress,
}: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  path: string;
  file: File;
  contentType: string;
  onProgress: (fraction: number) => void;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    // Where the video lands: a fresh place, or the place an earlier, interrupted upload of this same video started.
    let objectName = path;
    const upload = new Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${accessToken}`, apikey: anonKey, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: "exercise-media", objectName: path, contentType, cacheControl: "3600" },
      onProgress: (sent, total) => {
        if (total > 0) onProgress(sent / total);
      },
      onSuccess: () => resolve({ ok: true, path: objectName }),
      onError: (err) => {
        const status = (err as { originalResponse?: { getStatus(): number } }).originalResponse?.getStatus?.();
        if (status === 413) return resolve({ ok: false, error: "That video is too big to upload. Trim it shorter, then pick it again." });
        resolve({ ok: false, error: "The upload stopped. Check your signal and tap Record or choose video again: it picks up where it left off." });
      },
    });
    // The same video picked again after a dropped upload: carry on where it stopped (the earlier attempt's place in storage is reused).
    upload.findPreviousUploads().then((previous) => {
      const last = previous[0];
      if (last) {
        const earlierPath = (last.metadata as Record<string, string> | undefined)?.objectName;
        if (earlierPath) {
          objectName = earlierPath;
          upload.options.metadata = { ...upload.options.metadata, objectName: earlierPath };
        }
        upload.resumeFromPreviousUpload(last);
      }
      upload.start();
    });
  });
}
