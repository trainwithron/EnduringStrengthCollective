"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { firstNameOf, snoozeUntil } from "@/lib/attention-snooze";

export interface NeedsAttentionItem {
  athleteId: string;
  groupId: string;
  title: string;
  // The client's first name, for "No macros for [name]".
  firstName?: string;
  triggerKey: "program_ending" | "macros_missing";
  suggestedDateKey: string; // "YYYY-MM-DD" — where an "Add to calendar" click lands it
  alreadyOnCalendar: boolean; // true when auto-add mode already placed it
}

function clientFacingNotifyBody(triggerKey: NeedsAttentionItem["triggerKey"]): string {
  switch (triggerKey) {
    case "program_ending":
      return "Your current program wraps up soon — check in with your coach about what's next.";
    case "macros_missing":
      return "Your coach hasn't set your nutrition targets for next week yet — reach out if you need them sooner.";
  }
}

export function NeedsAttentionPanel({
  coachId,
  items,
}: {
  coachId: string;
  items: NeedsAttentionItem[];
}) {
  const router = useRouter();
  // Closed by default once there is more than a couple, so a full list never takes over Home.
  const [open, setOpen] = useState(items.length <= 2);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<Record<string, string>>({});
  // athleteId alone isn't unique — the same athlete can have both a
  // "program ending" and a "macros missing" suggestion active at once.
  const keyOf = (item: NeedsAttentionItem) => `${item.athleteId}::${item.triggerKey}`;

  async function handleAdd(item: NeedsAttentionItem) {
    setBusyKey(keyOf(item));
    const supabase = createBrowserClient();
    // Upsert with ignoreDuplicates — the unique index on (coach_id,
    // linked_athlete_id, trigger_key) makes this safe even if the same
    // suggestion somehow got added from two places at once.
    await saved(supabase.from("calendar_events").upsert(
      {
        coach_id: coachId,
        title: item.title,
        event_date: item.suggestedDateKey,
        event_type: "suggestion",
        trigger_key: item.triggerKey,
        linked_athlete_id: item.athleteId,
        linked_group_id: item.groupId,
        status: "active",
      },
      { onConflict: "coach_id,linked_athlete_id,trigger_key", ignoreDuplicates: true }
    ));
    setBusyKey(null);
    router.refresh();
  }

  async function handleNotify(item: NeedsAttentionItem) {
    const key = keyOf(item);
    setBusyKey(key);
    try {
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: item.athleteId,
          title: "A note from your coach",
          // item.title is written for the coach's own dashboard (third
          // person, "Robyn's program ends in 3 days — assign their next
          // one") — sending it verbatim used to go straight to the
          // client it's describing. A client-facing message instead,
          // keyed off the same trigger.
          body: clientFacingNotifyBody(item.triggerKey),
        }),
      });
      const data = await res.json();
      setNotifyStatus((prev) => ({
        ...prev,
        [key]: data.sent > 0 ? "Notified" : "No notifications enabled for them",
      }));
    } catch {
      setNotifyStatus((prev) => ({ ...prev, [key]: "Couldn't send" }));
    }
    setBusyKey(null);
  }

  // The item that was auto-added to the calendar goes with it when it is put off or switched off (it is added again if it is still true after).
  async function removeAutoAdded(supabase: ReturnType<typeof createBrowserClient>, athleteId: string, triggerKey: string) {
    await saved(supabase.from("calendar_events").delete().eq("coach_id", coachId).eq("event_type", "suggestion").eq("trigger_key", triggerKey).eq("linked_athlete_id", athleteId).eq("status", "active"));
  }

  // "Not now": hidden for this client for a week; it comes back only if it is still true after.
  async function handleNotNow(item: NeedsAttentionItem) {
    setBusyKey(keyOf(item));
    const supabase = createBrowserClient();
    const until = snoozeUntil(new Date());
    const { error } = await supabase.from("attention_snoozes").upsert({ coach_id: coachId, athlete_id: item.athleteId, group_id: item.groupId, trigger_key: item.triggerKey, until_date: until }, { onConflict: "coach_id,athlete_id,trigger_key" });
    if (!error) await removeAutoAdded(supabase, item.athleteId, item.triggerKey);
    setBusyKey(null);
    router.refresh();
  }

  // "No macros for [name]": this coach does not set macros for this client, so the nudge stops for good (turn it back on from the client's Nutrition tab).
  async function handleNoMacros(item: NeedsAttentionItem) {
    setBusyKey(keyOf(item));
    const supabase = createBrowserClient();
    const { data, error } = await supabase.from("group_memberships").update({ coach_sets_macros: false }).eq("group_id", item.groupId).eq("profile_id", item.athleteId).select("coach_sets_macros");
    if (!error && data && data.length > 0) await removeAutoAdded(supabase, item.athleteId, "macros_missing");
    setBusyKey(null);
    router.refresh();
  }

  if (items.length === 0) return null;

  const dismissable = items;

  // One quiet action for the whole list: puts every item off for a week.
  async function handleDismissAll() {
    if (dismissable.length === 0) return;
    setBusyKey("all");
    const supabase = createBrowserClient();
    const until = snoozeUntil(new Date());
    const { error } = await supabase.from("attention_snoozes").upsert(
      dismissable.map((item) => ({ coach_id: coachId, athlete_id: item.athleteId, group_id: item.groupId, trigger_key: item.triggerKey, until_date: until })),
      { onConflict: "coach_id,athlete_id,trigger_key" }
    );
    if (!error) for (const item of dismissable.filter((i) => i.alreadyOnCalendar)) await removeAutoAdded(supabase, item.athleteId, item.triggerKey);
    setBusyKey(null);
    router.refresh();
  }

  const busy = busyKey !== null;

  return (
    <div className="border border-yellow-500/40 bg-yellow-500/5 mb-6 max-w-2xl">
      {/* Collapsed to a single line until opened: a list that grows with every new client should not push the page down. */}
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 min-h-[32px] font-body text-xs text-chalk font-medium uppercase tracking-wide"
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          Needs attention
          <span className="text-steel normal-case tracking-normal">({items.length})</span>
        </button>
        {open && dismissable.length > 1 && (
          <button
            type="button"
            onClick={handleDismissAll}
            disabled={busy}
            className="font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40"
          >
            {busyKey === "all" ? "Clearing…" : "Not now for all"}
          </button>
        )}
      </div>
      {open && (
        <div className="divide-y divide-steel/15 border-t border-steel/15 px-3 max-h-72 overflow-y-auto">
          {items.map((item) => (
            <div key={keyOf(item)} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className="font-body text-xs leading-snug flex-1 min-w-[10rem]">{item.title}</p>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {item.alreadyOnCalendar ? (
                  <span className="font-body text-xs text-steel">On your calendar</span>
                ) : (
                  <>
                  {notifyStatus[keyOf(item)] && <span className="font-body text-xs text-steel">{notifyStatus[keyOf(item)]}</span>}
                  <button
                    type="button"
                    onClick={() => handleNotify(item)}
                    disabled={busy}
                    className="h-7 px-2 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
                    title="Send a push notification to this client"
                    aria-label="Notify this client"
                  >
                    🔔
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdd(item)}
                    disabled={busy}
                    className="h-7 px-2 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
                  >
                    Add
                  </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => handleNotNow(item)}
                  disabled={busy}
                  className="min-h-11 sm:min-h-7 px-2 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
                >
                  Not now
                </button>
                {item.triggerKey === "macros_missing" && (
                  <button
                    type="button"
                    onClick={() => handleNoMacros(item)}
                    disabled={busy}
                    className="min-h-11 sm:min-h-7 px-2 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
                  >
                    No macros for {item.firstName ?? firstNameOf(item.title)}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
