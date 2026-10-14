import type { SupabaseClient } from "@supabase/supabase-js";
import { addBullet, freshRaw, notesBlock, ruleBullet, type NoteBullet, type RawEntry } from "@/lib/client-notes";
import { labelFor } from "@/lib/context-tags";

// Reads one client's Past AI build notes as the coach (row policies keep it theirs). Nothing here ever throws into an AI path: no notes, or the table not there yet, is simply an empty list.
export async function loadClientNotes(supabase: SupabaseClient, coachId: string, athleteId: string | null): Promise<{ bullets: NoteBullet[]; raw: RawEntry[] }> {
  if (!athleteId) return { bullets: [], raw: [] };
  try {
    const { data } = await supabase.from("client_ai_notes").select("bullets, raw").eq("coach_id", coachId).eq("athlete_id", athleteId).maybeSingle();
    const row = data as { bullets?: NoteBullet[] | null; raw?: RawEntry[] | null } | null;
    return { bullets: Array.isArray(row?.bullets) ? (row?.bullets as NoteBullet[]) : [], raw: Array.isArray(row?.raw) ? freshRaw(row?.raw as RawEntry[]) : [] };
  } catch {
    return { bullets: [], raw: [] };
  }
}

export async function saveClientNotes(
  supabase: SupabaseClient,
  { coachId, athleteId, groupId, bullets, raw }: { coachId: string; athleteId: string; groupId: string; bullets: NoteBullet[]; raw: RawEntry[] }
): Promise<boolean> {
  const { error } = await supabase.from("client_ai_notes").upsert({ coach_id: coachId, athlete_id: athleteId, group_id: groupId, bullets, raw, updated_at: new Date().toISOString() }, { onConflict: "coach_id,athlete_id" });
  return !error;
}

// A rule the coach just taught for a client is also written on that client as a short note ("Back limits: no barbell squats"), which is how the app knows later that those rules fit this client.
export async function addRuleNote(
  supabase: SupabaseClient,
  { coachId, athleteId, groupId, whenKeys, thenText }: { coachId: string; athleteId: string; groupId: string; whenKeys: string[]; thenText: string }
): Promise<void> {
  try {
    const { bullets, raw } = await loadClientNotes(supabase, coachId, athleteId);
    const today = new Date().toISOString().slice(0, 10);
    const next = addBullet(bullets, ruleBullet(whenKeys.map((k) => labelFor(k)), thenText, whenKeys, today));
    if (next !== bullets) await saveClientNotes(supabase, { coachId, athleteId, groupId, bullets: next, raw });
  } catch {
    // best effort: the rule itself is already saved
  }
}

// The block for a prompt (null when there are no notes).
export async function loadNotesBlock(supabase: SupabaseClient, coachId: string, athleteId: string | null): Promise<string | null> {
  return notesBlock((await loadClientNotes(supabase, coachId, athleteId)).bullets);
}
