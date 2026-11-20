"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { copyRows, fetchFoodLogDay, insertCopies } from "@/lib/food-entry";
import { addDaysToKey } from "@/lib/date-key";

// "Copy yesterday": everything logged the day before the day shown, copied into it, once. It was the first control of the food log list (food-log-entries.tsx); the client
// Nutrition page's Look Refresh (Ron, Nov 20) shows it as a small pill under the ways to log, and the list keeps it wherever it is used alone. Same reads and writes as before.
export function CopyYesterdayButton({
  athleteId,
  groupId,
  logDate,
  isToday = true,
  onAdded,
  className = "min-h-[44px] px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-50",
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  // On another day than today (the day switcher), "yesterday" would be wrong: it copies the day before the day shown.
  isToday?: boolean;
  onAdded: (added: FoodLogEntry[]) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dayBefore = isToday ? "yesterday" : "the day before";

  async function copyFromYesterday() {
    if (busy || copied) return;
    setBusy(true);
    setNotice(null);
    const supabase = createBrowserClient();
    const yesterday = await fetchFoodLogDay(supabase, athleteId, addDaysToKey(logDate, -1));
    const rows = copyRows(yesterday, { athleteId, groupId, toDate: logDate });
    if (rows.length === 0) {
      setNotice(`Nothing was logged ${dayBefore} to copy.`);
      setBusy(false);
      return;
    }
    const added = await insertCopies(supabase, rows);
    setBusy(false);
    if (!added) {
      setNotice("That didn't copy. Try again.");
      return;
    }
    onAdded(added);
    // Once is enough: pressing it again would double the day.
    setCopied(true);
    setNotice(`Copied ${added.length} ${added.length === 1 ? "entry" : "entries"} from ${dayBefore}.`);
  }

  return (
    <>
      <button type="button" onClick={copyFromYesterday} disabled={busy || copied} className={className}>
        {copied ? `Copied from ${dayBefore}` : isToday ? "Copy yesterday" : "Copy the day before"}
      </button>
      {notice && (
        <p className="basis-full order-last font-body text-xs text-steel" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
