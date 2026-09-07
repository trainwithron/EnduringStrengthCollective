"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
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
