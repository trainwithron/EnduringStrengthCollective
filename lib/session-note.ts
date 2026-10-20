import type { SupabaseClient } from "@supabase/supabase-js";

// A note on a "Did this session happen?" card (Ron, Oct 19: "it would be nice to have a small notes section in this notification"). It goes into the client's existing private notes
// (athlete_notes: one row per client and group, coach-only), APPENDED as its own line that says which session it was about, so it shows in the client profile's private notes.
// Nothing new is stored anywhere else, and an empty note writes nothing.

/** "Oct 19, 4:00 PM session: <text>" on the coach's own clock. */
export function sessionNoteLine(startIso: string, timezone: string, text: string): string {
  const at = new Date(startIso);
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone });
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  return `${day}, ${time} session: ${text.trim()}`;
}

/** The old notes with the new line under them (the old text is never changed). */
export function appendNoteLine(oldBody: string | null | undefined, line: string): string {
  const before = (oldBody ?? "").replace(/\s+$/, "");
  return before ? `${before}\n${line}` : line;
}

export async function saveSessionNote(
  supabase: SupabaseClient,
  input: { athleteId: string; groupId: string; startIso: string; timezone: string; text: string }
): Promise<boolean> {
  const text = input.text.trim();
  if (!text) return true;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;
  const { data: row, error: readError } = await supabase.from("athlete_notes").select("id, body").eq("athlete_id", input.athleteId).eq("group_id", input.groupId).maybeSingle();
  if (readError) return false;
  const existing = row as { id: string; body: string | null } | null;
  const { error } = await supabase.from("athlete_notes").upsert(
    {
      id: existing?.id ?? undefined,
      athlete_id: input.athleteId,
      group_id: input.groupId,
      body: appendNoteLine(existing?.body, sessionNoteLine(input.startIso, input.timezone, text)),
      created_by: userData.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "athlete_id,group_id" }
  );
  return !error;
}
