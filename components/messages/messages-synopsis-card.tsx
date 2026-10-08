"use client";

import { useEffect, useMemo, useState } from "react";
import type { InboxConversation } from "@/lib/coach-inbox";
import { messagesSynopsis } from "@/lib/messages-synopsis";

const SHOWN = 5;

// A plain summary above the conversation list: who is waiting for a reply, the longest wait, and the first line of what each wrote. Counts and times only; nothing reads the
// messages with an AI. The clock is read after the page loads (never during the server render) so the page and the browser agree on the first paint.
export function MessagesSynopsisCard({ conversations, onPick }: { conversations: InboxConversation[]; onPick: (otherId: string) => void }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, [conversations]);
  const synopsis = useMemo(() => (now ? messagesSynopsis(conversations, now) : null), [conversations, now]);
  if (!synopsis) return null;
  const shown = synopsis.waiting.slice(0, SHOWN);
  return (
    <section className="border-b border-steel/15 px-3 py-2" aria-label="Messages summary" data-testid="messages-synopsis">
      <p className="font-body text-xs text-chalk">{synopsis.line}</p>
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {shown.map((w) => (
            <li key={w.otherId}>
              <button type="button" onClick={() => onPick(w.otherId)} className="w-full text-left min-h-9 py-1 font-body text-xs text-steel hover:text-chalk">
                <span className="text-chalk">{w.fullName}</span> · {w.waited}
                {w.firstLine ? <span className="block truncate">{w.firstLine}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {synopsis.waitingCount > SHOWN && <p className="font-body text-xs text-steel">and {synopsis.waitingCount - SHOWN} more</p>}
    </section>
  );
}
