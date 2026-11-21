"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stashDraft, withDraftKey } from "@/lib/message-draft";

// A link to a conversation that opens with a drafted message in the box, with no words and no guessable key in the address (lib/message-draft.ts). The link drawn on the page is the plain
// conversation. A plain press makes a random key, keeps the words in this tab under it and opens the conversation with ?draft=<key>. A press that opens a new tab or window (middle-click,
// Ctrl or Cmd) is left to the browser: the conversation opens with an empty box.
export function DraftMessageLink({ threadHref, draft, className, children }: { threadHref: string; draft: string; className?: string; children?: ReactNode }) {
  const router = useRouter();
  function open(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const key = stashDraft(draft);
    const href = key ? withDraftKey(threadHref, key) : threadHref;
    router.push(href);
  }
  return (
    <Link prefetch={false} href={threadHref} onClick={open} className={className} data-message-draft>
      {children}
    </Link>
  );
}
