"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";

// The coach's newest announcement, pinned above the feed until it is read (CL17, Ron Nov 21: the feed opened on General and announcements were easy to miss). "Read" is this
// device's own note: "Got it", or opening the Announcements tab, marks it, and a newer announcement shows again. (There is no per-person read record for posts; nothing is saved
// to the database.) It waits for that note before showing, so a read one never flashes in.
const seenKey = (groupId: string) => `feed-announcement-seen:${groupId}`;

function readSeen(groupId: string): string | null {
  try {
    return window.localStorage.getItem(seenKey(groupId));
  } catch {
    return null;
  }
}

function writeSeen(groupId: string, postId: string): void {
  try {
    window.localStorage.setItem(seenKey(groupId), postId);
  } catch {
    // a private window: it shows again next time, which is harmless
  }
}

export interface PinnedAnnouncementPost {
  id: string;
  body: string;
  authorName: string;
  when: string;
}

export function PinnedAnnouncement({ groupId, post, announcementsHref }: { groupId: string; post: PinnedAnnouncementPost; announcementsHref: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(readSeen(groupId) !== post.id);
  }, [groupId, post.id]);
  if (!show) return null;
  return (
    <section aria-label="Newest announcement" className="tint-accent rounded-card px-4 py-3 mb-4" data-pinned-announcement>
      <p className="flex items-center gap-1.5 font-body text-xs font-semibold text-rust-ink uppercase tracking-wide">
        <Megaphone className="w-4 h-4" aria-hidden="true" />
        Announcement · {post.authorName} · {post.when}
      </p>
      <p className="mt-1 font-body text-sm text-chalk whitespace-pre-line break-words line-clamp-4">{post.body}</p>
      <div className="mt-1 flex items-center gap-4">
        <Link href={announcementsHref} prefetch={false} className="min-h-11 inline-flex items-center font-body text-sm text-rust-ink underline underline-offset-2">
          See announcements
        </Link>
        <button
          type="button"
          onClick={() => {
            writeSeen(groupId, post.id);
            setShow(false);
          }}
          className="min-h-11 px-2 font-body text-sm text-steel active:text-chalk"
          data-announcement-got-it
        >
          Got it
        </button>
      </div>
    </section>
  );
}

/** On the Announcements tab: the newest one counts as read. */
export function MarkAnnouncementSeen({ groupId, postId }: { groupId: string; postId: string }) {
  useEffect(() => {
    writeSeen(groupId, postId);
  }, [groupId, postId]);
  return null;
}
