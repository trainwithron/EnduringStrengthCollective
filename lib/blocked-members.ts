import type { SupabaseClient } from "@supabase/supabase-js";

// The members this person has blocked. A database that does not have the table yet (the Release CM1 paste is pending) reads as nobody blocked. Any other failure also reads as nobody blocked, and is logged:
// a block is a comfort, not a safety wall, so a failed read shows the feed rather than hiding it.
export async function loadBlockedIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("user_blocks").select("blocked_id");
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code !== "42P01" && code !== "PGRST205") console.error("[blocked members] could not read the list:", error.message);
    return [];
  }
  return ((data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id);
}
