import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogDemo, MACHINE_DEMOS_BUCKET } from "@/lib/machine-catalog";

// The QR pages' demo for an exercise on a machine (Commander, Nov 19): a machine added from the shared machine list shows the list's demo (read live: when Ron fixes or adds a video
// every gym sees it), the filmed video before a YouTube link; otherwise, or when the list has none, the coach's own demo as before.
export type ScanDemo = { kind: "video"; bucket: "exercise-media" | "machine-demos"; path: string } | { kind: "youtube"; url: string } | null;

export interface SharedDemoRow {
  videoPath: string | null;
  youtubeUrl: string | null;
}

export function scanDemo(shared: SharedDemoRow | null | undefined, own: { video_path: string | null; youtube_url: string | null }): ScanDemo {
  const fromList = catalogDemo(shared);
  if (fromList?.kind === "video") return { kind: "video", bucket: MACHINE_DEMOS_BUCKET, path: fromList.path };
  if (fromList?.kind === "youtube") return fromList;
  if (own.video_path) return { kind: "video", bucket: "exercise-media", path: own.video_path };
  if (own.youtube_url && own.youtube_url.trim()) return { kind: "youtube", url: own.youtube_url.trim() };
  return null;
}

// The shared list's demos for these exercises (read with the server's key on the public QR pages). Fails soft: before the database step, or on a failed read, no shared demos.
export async function loadSharedDemos(client: SupabaseClient, itemIds: (string | null | undefined)[]): Promise<Map<string, SharedDemoRow>> {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  const out = new Map<string, SharedDemoRow>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await client.from("catalog_machine_exercises").select("id, video_path, youtube_url").in("id", ids);
    if (error) return out;
    for (const r of (data ?? []) as { id: string; video_path: string | null; youtube_url: string | null }[]) out.set(r.id, { videoPath: r.video_path, youtubeUrl: r.youtube_url });
  } catch {
    // no shared demos
  }
  return out;
}
