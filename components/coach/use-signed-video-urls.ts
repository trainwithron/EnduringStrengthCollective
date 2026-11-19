"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Signed links for the uploaded demo videos shown (both video buckets are private), one batch per set of videos: exercise-media (a coach's own demos) or machine-demos (the shared
// machine list's demos, migration 0453).
export function useSignedVideoUrls(paths: string[], bucket: "exercise-media" | "machine-demos" = "exercise-media"): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = [...paths].sort().join("|");
  useEffect(() => {
    const missing = paths.filter((p) => !urls[p]);
    if (missing.length === 0) return;
    let cancelled = false;
    void createBrowserClient()
      .storage.from(bucket)
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setUrls((prev) => ({ ...prev, ...Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string])) }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bucket]);
  return urls;
}
