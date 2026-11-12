// Before a demo uploads, the phone makes it 1080p (Ron, Nov 12: "can i set it to stream at 1080 to save bandwidth") and, when asked, takes the sound out ("can i mute the videos before
// i upload"). A 4K demo then uploads and plays at about a sixth of its size. Done in the browser (no outside video service); the sound is kept as it is unless muted.
// When the phone's browser can't convert, the original video is used (still up to 30 seconds), except a mute it can't do is said plainly instead of uploading the sound.

import { demoFileProblem } from "./exercise-demo-upload";

/** The longest side a demo keeps: 1080p. */
export const DEMO_LONG_SIDE = 1920;

/** The size to convert to, or null to keep the picture as it is. Portrait phone video stays portrait. */
export function demoTargetSize(displayWidth: number, displayHeight: number): { width: number } | { height: number } | null {
  if (Math.max(displayWidth, displayHeight) <= DEMO_LONG_SIDE) return null;
  return displayWidth >= displayHeight ? { width: DEMO_LONG_SIDE } : { height: DEMO_LONG_SIDE };
}

export const CANT_MUTE = "This phone can't take the sound out here. Mute it in your phone's gallery editor first, or upload it with sound.";

export type PreparedDemo = { ok: true; file: File; converted: boolean } | { ok: false; error: string };

export async function prepareDemo(file: File, { mute, onProgress }: { mute: boolean; onProgress: (fraction: number) => void }): Promise<PreparedDemo> {
  // The original, as it was: only when it is a type and size the library takes.
  const asIs = (seconds: number | null): PreparedDemo => {
    const problem = demoFileProblem(file, seconds);
    return problem ? { ok: false, error: problem } : { ok: true, file, converted: false };
  };

  let mb: typeof import("mediabunny");
  try {
    mb = await import("mediabunny");
  } catch {
    return mute ? { ok: false, error: CANT_MUTE } : asIs(null);
  }
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return { ok: false, error: "That file has no video in it." };
    const seconds = await input.computeDuration();
    // Too long is said before any work is done.
    const tooLong = demoFileProblem({ type: "video/mp4", name: "x.mp4", size: 0 }, seconds);
    if (tooLong) return { ok: false, error: tooLong };

    const size = demoTargetSize(video.displayWidth, video.displayHeight);
    if (!size && !mute) return asIs(seconds);

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: size ? { ...size, codec: "avc", quality: mb.QUALITY_HIGH } : {},
      audio: mute ? { discard: true } : {},
    });
    if (!conversion.isValid) return mute ? { ok: false, error: CANT_MUTE } : asIs(seconds);
    conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) return mute ? { ok: false, error: CANT_MUTE } : asIs(seconds);
    const base = file.name.replace(/\.[^.]+$/, "") || "demo";
    const out = new File([buffer], `${base}-1080p.mp4`, { type: "video/mp4", lastModified: file.lastModified });
    const problem = demoFileProblem(out, seconds);
    return problem ? { ok: false, error: problem } : { ok: true, file: out, converted: true };
  } catch {
    return mute ? { ok: false, error: CANT_MUTE } : asIs(null);
  } finally {
    input.dispose();
  }
}
