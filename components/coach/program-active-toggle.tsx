"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { signOffProgram } from "@/components/coach/ai-draft-banner";

// Activation is per program. A coach can run several programs for the same
// client at once (their main programming, a mobility program for off days,
// a warm-up flow), so activating or deactivating this one never touches any
// other program — shared or personal.
export function ProgramActiveToggle({
  programId,
  isActive,
  aiDraft = false,
  programName = "this program",
}: {
  programId: string;
  isActive: boolean;
  // An AI-built program that is not signed off yet: the switch becomes "Draft: sign off", which makes it active in one step (a draft can never be made active any other way).
  aiDraft?: boolean;
  programName?: string;
}) {
  const [optimisticActive, setOptimisticActive] = useState(isActive);
  const router = useRouter();

  async function handleSignOff() {
    if (!(await confirmDialog({ message: `Sign off "${programName}" and make it active? Clients it is assigned to will see it.`, confirmLabel: "Sign off" }))) return;
    if (await signOffProgram(programId)) router.refresh();
  }

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

  if (aiDraft) {
    return (
      <button type="button" onClick={handleSignOff} className="font-body text-xs shrink-0 text-rust underline underline-offset-2">
        AI draft: sign off
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`font-body text-xs shrink-0 transition-colors ${
        optimisticActive ? "text-moss active:text-steel" : "text-steel active:text-rust"
      }`}
    >
      {optimisticActive ? "Active" : "Set active"}
    </button>
  );
}
