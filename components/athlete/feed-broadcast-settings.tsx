"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type BroadcastLevel = "full" | "prs_only" | "checkin_only" | "private";

const OPTIONS: { value: BroadcastLevel; label: string; description: string }[] = [
  {
    value: "full",
    label: "Full session log",
    description: "Complete volume, sets, and PR detail — today's default.",
  },
  {
    value: "prs_only",
    label: "PRs & breakthroughs only",
    description: "Only posts when you hit a new PR. Everything else stays private.",
  },
  {
    value: "checkin_only",
    label: "Check-in only",
    description: "A lightweight \"workout complete\" badge — no numbers, no PR detail.",
  },
  {
    value: "private",
    label: "Keep private",
    description: "Never posts to the feed. Still saved to your own history.",
  },
];

export function FeedBroadcastSettings({ initialLevel }: { initialLevel: BroadcastLevel }) {
  const [level, setLevel] = useState<BroadcastLevel>(initialLevel);
  const [saving, setSaving] = useState(false);

  async function handleChange(value: BroadcastLevel) {
    setLevel(value);
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ feed_broadcast_level: value }).eq("id", user.id);
    }
    setSaving(false);
  }

  return (
    <div>
      <p className="font-body text-sm mb-1">What posts to the feed when you finish a workout</p>
      <p className="font-body text-xs text-steel mb-3">
        {saving ? "Saving…" : "Applies the next time you complete a workout."}
      </p>
      <div className="space-y-2">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`block border p-3 cursor-pointer ${
              level === opt.value ? "border-rust bg-surface/40" : "border-steel/20"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="feed-broadcast-level"
                checked={level === opt.value}
                onChange={() => handleChange(opt.value)}
                className="w-4 h-4"
              />
              <span className="font-body text-sm font-medium">{opt.label}</span>
            </div>
            <p className="font-body text-xs text-steel mt-1 pl-6">{opt.description}</p>
          </label>
        ))}
      </div>
    </div>
  );
}
