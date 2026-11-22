"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FEED_CHANNEL_LABELS, type FeedChannel } from "@/lib/types";
import { ALL_FEED_CHANNELS } from "@/lib/feed-channels";

// The feed's channel tabs. Which ones show is lib/feed-channels.ts (CL17, Nov 21): the channels with posts, the open one, General and, for a coach, Announcements; the empty ones
// are behind "More". Team Chat is more conversational than the others by design, so where it shows (a team-sport group) it sits last. The labels are the app's one set (lib/types.ts).
export function ChannelTabs({
  basePath,
  active,
  channels,
  more = [],
}: {
  basePath: string;
  active: FeedChannel;
  channels: FeedChannel[];
  more?: FeedChannel[];
}) {
  const row = useRef<HTMLDivElement>(null);
  const [showMore, setShowMore] = useState(false);
  const shown = showMore ? [...channels, ...more].sort((a, b) => order(a) - order(b)) : channels;

  // The row scrolls sideways on a phone; the selected tab is brought into the middle so it is never off the right edge with nothing lit.
  useEffect(() => {
    const container = row.current;
    const tab = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !tab) return;
    container.scrollLeft = tab.offsetLeft - (container.clientWidth - tab.offsetWidth) / 2;
  }, [active]);

  return (
    <div ref={row} className="flex items-center gap-1 border-b border-steel/20 overflow-x-auto" data-channel-tabs>
      {shown.map((key) => (
        <Link
          key={key}
          href={`${basePath}${basePath.includes("?") ? "&" : "?"}channel=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`h-11 px-4 flex items-center font-body text-sm whitespace-nowrap border-b-2 transition-colors shrink-0 ${
            active === key
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          {FEED_CHANNEL_LABELS[key]}
        </Link>
      ))}
      {!showMore && more.length > 0 && (
        <button type="button" onClick={() => setShowMore(true)} className="h-11 px-3 flex items-center font-body text-sm text-steel whitespace-nowrap shrink-0 active:text-chalk" data-more-channels>
          More
        </button>
      )}
    </div>
  );
}

const order = (c: FeedChannel) => ALL_FEED_CHANNELS.indexOf(c);
