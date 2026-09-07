"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function AthleteNotesEditor({
  athleteId,
  groupId,
  noteId,
  initialBody,
}: {
  athleteId: string;
  groupId: string;
  noteId: string | null;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBlur() {
    if (body === initialBody) return;
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSaving(false);
      return;
    }

    const { error: upsertError } = await supabase.from("athlete_notes").upsert(
      {
        id: noteId ?? undefined,
        athlete_id: athleteId,
        group_id: groupId,
        body,
        created_by: userData.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id,group_id" }
    );

    if (upsertError) {
      setError(upsertError.message);
    }
    setSaving(false);
  }

  return (
    <div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={handleBlur}
        rows={4}
        placeholder="Private notes for this client — injuries, goals, anything to remember. Only you can see this."
        className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
      />
      {saving && <p className="font-body text-xs text-steel mt-1">Saving…</p>}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
