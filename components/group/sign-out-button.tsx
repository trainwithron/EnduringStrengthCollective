"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { clearWorkspaceStorage } from "@/lib/workspace-layout";
import { clearAllNoteDrafts } from "@/lib/note-draft";
import { clearAllFunLineMemory } from "@/lib/fun-line-memory";
import { unsubscribeFromPush } from "@/lib/push-client";
import { purgeOfflinePages } from "@/lib/offline-pages";
import { SPOT_NEEDS_CACHE_KEY } from "@/lib/spot-needs";

export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createBrowserClient();
    // This device stops getting this person's notifications (the next person to sign in here would otherwise be sent them). Done while still signed in; a failure must not block signing out.
    await unsubscribeFromPush().catch(() => undefined);
    await supabase.auth.signOut();
    clearWorkspaceStorage(window.localStorage);
    // A shared phone must not keep someone's unsaved exercise notes (they can be about pain or injury).
    clearAllNoteDrafts();
    // Nor the lines their share cards showed (they hold their workout numbers).
    clearAllFunLineMemory(window.localStorage);
    // Nor the workout pages kept for opening with no signal.
    purgeOfflinePages();
    // What needed the coach (Spotlight's dot), kept for a minute per tab: never shown to the next person on a shared phone.
    try {
      window.sessionStorage.removeItem(SPOT_NEEDS_CACHE_KEY);
    } catch {
      // nothing kept
    }
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
