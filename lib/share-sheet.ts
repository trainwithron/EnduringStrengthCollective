"use client";

// The phone's own share sheet (Messages, WhatsApp, email, Copy...): true when it opened, false when this phone has none or the coach closed it.
export async function shareText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    await navigator.share({ text });
    return true;
  } catch {
    return false;
  }
}

export function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
