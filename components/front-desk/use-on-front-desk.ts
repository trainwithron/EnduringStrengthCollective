"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Is the signed-in person on some organization's front desk? Reads only their own row (row security). Asked once per page load; "no" until known, and when the read fails.
let asked: Promise<boolean> | null = null;

export function useOnFrontDesk(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    asked ??= (async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return false;
        const { data, error } = await supabase.from("org_front_desk").select("organization_id").eq("profile_id", user.id).limit(1);
        return !error && (data ?? []).length > 0;
      } catch {
        return false;
      }
    })();
    asked.then((v) => {
      if (!cancelled) setOn(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
