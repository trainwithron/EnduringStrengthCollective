"use client";

import { smsHref, smsPlatformOf } from "@/lib/client-claim";

// The texting-app link for the phone this runs on (read when tapped, so the page renders the same on the server and in the browser).
export function phoneSmsHref(body: string): string {
  if (typeof navigator === "undefined") return smsHref(body);
  return smsHref(body, smsPlatformOf(navigator.userAgent, navigator.maxTouchPoints ?? 0));
}

// The phone's own share sheet (Messages, WhatsApp, email...): true when it opened, false when this phone has none or the coach closed it.
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
