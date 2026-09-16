import type { SupabaseClient } from "@supabase/supabase-js";
import { hashApiKey } from "@/lib/api-key";

// Zapier's REST Hooks calls carry no Supabase session at all — this is
// the "auth" for every /api/zapier/* route, the same role a Postgres
// session's auth.uid() plays everywhere else in this app. Hashes the
// presented bearer token and looks it up by the stored hash (never a
// plaintext comparison, since coach_api_keys never stores plaintext).
export async function resolveCoachFromApiKey(
  supabase: SupabaseClient,
  request: Request
): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const { data } = await supabase
    .from("coach_api_keys")
    .select("coach_id")
    .eq("api_key_hash", hashApiKey(token))
    .maybeSingle();
  if (!data) return null;

  await supabase.from("coach_api_keys").update({ last_used_at: new Date().toISOString() }).eq("coach_id", data.coach_id);
  return data.coach_id;
}
