"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { isCoachType, type CoachType } from "@/lib/coach-type";

let cached: Promise<CoachType | null> | null = null;

// What the signed-in coach said they coach (profiles.coach_type), read once per page load. null until known, and when it was never asked or cannot be read: the menus then stay as they always were.
export function useCoachType(): CoachType | null {
  const [type, setType] = useState<CoachType | null>(null);
  useEffect(() => {
    let cancelled = false;
    cached ??= (async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return null;
        const { data } = await supabase.from("profiles").select("coach_type").eq("id", user.id).maybeSingle();
        const value = (data as { coach_type?: string | null } | null)?.coach_type;
        return isCoachType(value) ? value : null;
      } catch {
        return null;
      }
    })();
    cached.then((v) => {
      if (!cancelled) setType(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return type;
}
