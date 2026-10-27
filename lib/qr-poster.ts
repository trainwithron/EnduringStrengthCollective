import { coachFirstNameOf } from "@/lib/share-image";

// What goes on a QR poster (components/coach/qr-poster-button.tsx), for every coach (Ron, Oct 27: "yes to team qr and that should apply to all coaches, if a gym wants to put up trainer
// posters itd be nice to scan the qr code and have that link take them to the trainer page"). Two kinds: joining a group (its current invite link) and a coach's own public page
// (/c/<slug>). Only the group's name and the coach's own public details go on a poster: never anything about a client.

export interface PosterContent {
  // Large, at the top.
  title: string;
  // Under the code, smaller.
  lines: string[];
  // The last line, what scanning does.
  callToAction: string;
}

export function inviteUrl(origin: string, code: string): string {
  return `${origin}/invite/${code}`;
}

export function joinPoster(groupName: string, coachName: string | null | undefined): PosterContent {
  const name = coachName?.trim();
  return { title: groupName, lines: name ? [name] : [], callToAction: `Scan to join ${groupName}` };
}

export function myPagePoster(coachName: string | null | undefined, handle: string | null | undefined): PosterContent {
  const name = coachName?.trim() || "Your coach";
  return { title: name, lines: handle ? [`@${handle}`] : [], callToAction: `Scan to train with ${coachFirstNameOf(coachName)}` };
}

// "Bulldogs 14U" -> "bulldogs-14u-qr.png"
export function posterFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "spotlight"}-qr.png`;
}
