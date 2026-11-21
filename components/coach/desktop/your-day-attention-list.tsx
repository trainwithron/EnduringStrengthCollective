"use client";

import { useState } from "react";
import Link from "next/link";
import { KIND_LABEL, type AttentionItem } from "@/lib/your-day";

// The ranked "needs you" list in Your day: the first `limit` rows, and a button for the rest that opens them right here and closes them again (audit, Nov 21: "and N more below" pointed
// at nothing in particular).
export function YourDayAttentionList({ items, limit = 6 }: { items: AttentionItem[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const hidden = Math.max(0, items.length - limit);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <ul className="space-y-2">
        {shown.map((a) => (
          <li key={a.id}>
            <Link prefetch={false} href={a.href} className="flex items-baseline gap-3 group">
              <span className="font-body text-xs text-steel w-16 shrink-0">{KIND_LABEL[a.kind]}</span>
              <span className="min-w-0">
                <span className="font-body text-sm text-chalk group-hover:underline">{a.text}</span>
                {a.detail && <span className="block font-body text-xs text-steel truncate">{a.detail}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="mt-1 inline-flex items-center gap-1.5 min-h-11 font-body text-[13px] font-semibold text-steel hover:text-chalk">
          <span aria-hidden="true">{all ? "▾" : "▸"}</span>
          {all ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}
