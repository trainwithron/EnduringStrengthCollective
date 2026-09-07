"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Exactly one program can be "active" per group at a time — athletes see
// every active program on their group hub with no signal about which one
// actually matters, so activating one here deactivates every other program
// in the group in the same action.
export function ProgramActiveToggle({
  programId,
  groupId,
  isActive,
}: {
  programId: string;
  groupId: string;
  isActive: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    setBusy(true);
    const supabase = createBrowserClient();

    if (isActive) {
      await supabase.from("programs").update({ is_active: false }).eq("id", programId);
    } else {
      await supabase
        .from("programs")
        .update({ is_active: false })
        .eq("group_id", groupId)
        .neq("id", programId);
      await supabase.from("programs").update({ is_active: true }).eq("id", programId);
    }

    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={busy}
      className={`font-body text-[11px] shrink-0 transition-colors disabled:opacity-40 ${
        isActive ? "text-moss active:text-steel" : "text-steel active:text-rust"
      }`}
    >
      {busy ? "…" : isActive ? "Active" : "Set active"}
    </button>
  );
}
