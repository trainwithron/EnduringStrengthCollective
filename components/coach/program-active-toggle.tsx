"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Activation is per program. A coach can run several programs for the same
// client at once (their main programming, a mobility program for off days,
// a warm-up flow), so activating or deactivating this one never touches any
// other program — shared or personal.
export function ProgramActiveToggle({
  programId,
  isActive,
}: {
  programId: string;
  isActive: boolean;
}) {
  const [optimisticActive, setOptimisticActive] = useState(isActive);
  const router = useRouter();

  async function handleToggle() {
    const nextActive = !optimisticActive;
    // Flip the label instantly; revert if the write fails.
    setOptimisticActive(nextActive);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("programs").update({ is_active: nextActive }).eq("id", programId);
    if (error) {
      setOptimisticActive(!nextActive);
      return;
    }
    router.refresh();
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
