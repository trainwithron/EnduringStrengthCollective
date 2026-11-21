"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { draftThreadHref, stashDraft } from "@/lib/message-draft";

// A link to a conversation that opens with a drafted message in the box, without the words in the address (lib/message-draft.ts): pressing it keeps the draft in this tab under the key the
// address carries, then the conversation reads it back.
export function DraftMessageLink({ threadHref, draft, className, children }: { threadHref: string; draft: string; className?: string; children?: ReactNode }) {
  const keep = () => {
    stashDraft(draft);
  };
  return (
    <Link prefetch={false} href={draftThreadHref(threadHref, draft)} onClick={keep} onAuxClick={keep} className={className} data-message-draft>
      {children}
    </Link>
  );
}
