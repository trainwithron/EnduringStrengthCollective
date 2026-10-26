import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemoRow } from "@/lib/exercise-demo";

// The Spotlight demo library (migration 0434): the demos on a platform admin's exercises, read through platform_demo_rows() (the demo fields only). Read once per page render and
// shared by everything under it. Fails soft: no platform demos (before the database step, or a failed read), and every coach's own demos work exactly as before.
export const loadPlatformDemos = cache(readPlatformDemos);

async function readPlatformDemos(supabase: SupabaseClient): Promise<DemoRow[]> {
  try {
    const { data, error } = await supabase.rpc("platform_demo_rows");
    if (error || !Array.isArray(data)) return [];
    return (data as { name: string; video_path: string | null; youtube_url: string | null }[]).map((r) => ({ name: r.name, videoPath: r.video_path, youtubeUrl: r.youtube_url, platform: true }));
  } catch {
    return [];
  }
}
