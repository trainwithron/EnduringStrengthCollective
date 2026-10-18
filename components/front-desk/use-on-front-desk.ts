"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Is the signed-in person on some organization's front desk? Reads only their own row (row security). The answer is kept per person (a second person signing in on the same tab asks again), and a signed-out
// moment or a failed read is never kept: the link just stays out of the menu until the next page load.
let kept: { userId: string; on: boolean } | null = null;

export async function askOnFrontDesk(): Promise<boolean> {
  try {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    if (kept && kept.userId === user.id) return kept.on;
    const { data, error } = await supabase.from("org_front_desk").select("organization_id").eq("profile_id", user.id).limit(1);
    if (error) return false;
    kept = { userId: user.id, on: (data ?? []).length > 0 };
    return kept.on;
  } catch {
    return false;
  }
}

export function resetOnFrontDesk(): void {
  kept = null;
}

export function useOnFrontDesk(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    askOnFrontDesk().then((v) => {
      if (!cancelled) setOn(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
