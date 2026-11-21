// Voice notes in Messages (R7, Ron Nov 20): the small rules the recorder, the send and the player share, kept here so they can be tested without a browser.
// The file goes into the private voice-notes bucket at {sender}/{space}/{random}.{ext} (migration 0464 holds the same rule), at most two minutes long.
export const VOICE_BUCKET = "voice-notes";
export const VOICE_MAX_SECONDS = 120;
// How long a link to play one lasts. Short on purpose: the player asks for a new one when it is needed again.
export const VOICE_LINK_SECONDS = 300;
// What a voice note says in the message list, the bell and anywhere else only the words are shown.
export const VOICE_NOTE_BODY = "Voice note";

// The recording formats in the order they are tried. MP4 first: every phone and computer plays it (an iPhone may not play webm), so every browser that can record MP4
// does; then webm and ogg for the browsers that cannot. The bucket accepts all three.
const CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"] as const;

export function pickVoiceMimeType(isTypeSupported: ((t: string) => boolean) | null | undefined): string | null {
  if (!isTypeSupported) return null;
  for (const t of CANDIDATES) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      // a browser that throws on the question does not record that type
    }
  }
  return null;
}

// "audio/webm;codecs=opus" is stored as "audio/webm" (the bucket's list names the plain type).
export function baseMimeType(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function voiceExtension(mime: string): "webm" | "m4a" | "ogg" | null {
  const base = baseMimeType(mime);
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return null;
}

export function voicePath(senderId: string, groupId: string, fileId: string, mime: string): string | null {
  const ext = voiceExtension(mime);
  return ext ? `${senderId}/${groupId}/${fileId}.${ext}` : null;
}

// The type of a stored recording, from its name (the database allows only these three endings).
export function voiceMimeFromPath(path: string): "audio/webm" | "audio/mp4" | "audio/ogg" | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  return null;
}

// Can this device play it? Asked of the browser before anything is fetched ("" means no; "maybe" and "probably" are a yes).
export function canPlayVoice(canPlayType: ((t: string) => string) | null | undefined, path: string): boolean {
  const type = voiceMimeFromPath(path);
  if (!type || !canPlayType) return false;
  try {
    return canPlayType(type) !== "";
  } catch {
    return false;
  }
}

export const VOICE_CANNOT_PLAY = "This phone can't play this recording. Open Messages on a computer, or ask them to type it.";

// Whole seconds for the message: at least 1, at most the limit. A recording under half a second is nothing (an accidental tap) and is not sent.
export function voiceSeconds(elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 500) return null;
  return Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.round(elapsedMs / 1000)));
}

// 0:07, 1:45, 2:00
export function formatVoiceTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Can this browser record at all? Only then is the microphone shown. Nothing is asked of the person here: permission is asked when they tap the microphone.
export function canRecordVoice(win: { MediaRecorder?: { isTypeSupported?: (t: string) => boolean }; navigator?: { mediaDevices?: { getUserMedia?: unknown } } } | undefined): boolean {
  if (!win || !win.MediaRecorder || typeof win.navigator?.mediaDevices?.getUserMedia !== "function") return false;
  return pickVoiceMimeType(win.MediaRecorder.isTypeSupported?.bind(win.MediaRecorder)) !== null;
}

// The push the other person gets (Ron: "{Name} sent a voice note").
export function voiceNotePushTitle(senderName: string): string {
  return `${senderName.trim() || "Someone"} sent a voice note`;
}

// What the hold-or-tap button does when it is let go: a press held longer than this is a hold (letting go sends), a shorter one is a tap (recording keeps going, with Send and Cancel).
export const HOLD_MS = 450;
export function releaseAction(pressedMs: number): "send" | "keep" {
  return pressedMs >= HOLD_MS ? "send" : "keep";
}
