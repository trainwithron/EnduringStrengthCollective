"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

type Status = "draft" | "active" | "completed";

const NEXT: Record<Status, { label: string; next: Status } | null> = {
  draft: { label: "Publish (open for joining)", next: "active" },
  active: { label: "Mark completed", next: "completed" },
  completed: null,
};

export function ChallengeStatusControl({
  challengeId,
  status,
}: {
  challengeId: string;
  status: Status;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const action = NEXT[status];

  async function handleClick() {
    if (!action) return;
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("challenges").update({ status: action.next }).eq("id", challengeId);
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={`font-body text-xs uppercase tracking-wide px-2 py-1 border ${
          status === "active"
            ? "border-positive text-positive"
            : status === "completed"
            ? "border-steel/40 text-steel"
            : "border-rust text-rust"
        }`}
      >
        {status}
      </span>
      {action && (
        <button
          type="button"
          onClick={handleClick}
          disabled={saving}
          className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {saving ? "Saving…" : action.label}
        </button>
      )}
    </div>
  );
}
