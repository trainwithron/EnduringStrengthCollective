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
  const [optimisticActive, setOptimisticActive] = useState(isActive);
  const router = useRouter();

  function handleToggle() {
    const nextActive = !optimisticActive;
    // Flip the label instantly; the (possibly two-step) write runs in the
    // background instead of the button sitting on "…" through it.
    setOptimisticActive(nextActive);
    const supabase = createBrowserClient();

    const write = nextActive
      ? supabase
          .from("programs")
          .update({ is_active: false })
          .eq("group_id", groupId)
          .neq("id", programId)
          .then(() => supabase.from("programs").update({ is_active: true }).eq("id", programId))
      : supabase.from("programs").update({ is_active: false }).eq("id", programId);

    write.then(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`font-body text-[11px] shrink-0 transition-colors ${
        optimisticActive ? "text-moss active:text-steel" : "text-steel active:text-rust"
      }`}
    >
      {optimisticActive ? "Active" : "Set active"}
    </button>
  );
}
