"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { FEED_CHANNEL_LABELS, type FeedChannel } from "@/lib/types";

// Team Chat is more conversational/casual than the other 4 by design, not just in
// copy — same channel machinery underneath, so it sits last, past the
// more purposeful channels. The labels are the app's one set (lib/types.ts).
const CHANNELS: FeedChannel[] = ["announcements", "form_checks", "pr_board", "general", "team_chat"];

export function ChannelTabs({
  basePath,
  active,
}: {
  basePath: string;
  active: FeedChannel;
}) {
  const row = useRef<HTMLDivElement>(null);

  // The row scrolls sideways on a phone; the selected tab is brought into the middle so it is never off the right edge with nothing lit.
  useEffect(() => {
    const container = row.current;
    const tab = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !tab) return;
    container.scrollLeft = tab.offsetLeft - (container.clientWidth - tab.offsetWidth) / 2;
  }, [active]);

  return (
    <div ref={row} className="flex items-center gap-1 border-b border-steel/20 overflow-x-auto">
      {CHANNELS.map((key) => (
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
    </div>
  );
}
