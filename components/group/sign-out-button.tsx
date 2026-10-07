"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { clearWorkspaceStorage } from "@/lib/workspace-layout";
import { clearAllNoteDrafts } from "@/lib/note-draft";
import { clearAllFunLineMemory } from "@/lib/fun-line-memory";

export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    clearWorkspaceStorage(window.localStorage);
    // A shared phone must not keep someone's unsaved exercise notes (they can be about pain or injury).
    clearAllNoteDrafts();
    // Nor the lines their share cards showed (they hold their workout numbers).
    clearAllFunLineMemory(window.localStorage);
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className="font-body text-xs text-steel uppercase tracking-wide disabled:opacity-40"
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
