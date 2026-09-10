"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function EditDisplayName({ initialName, profileId }: { initialName: string; profileId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: trimmed })
      .eq("id", profileId);
    setSaving(false);
    if (updateError) {
      setError("Couldn't save — check your connection and try again.");
      return;
    }
    setName(trimmed);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left"
      >
        <p className="font-body font-medium text-[15px]">{name}</p>
        <p className="font-body text-xs text-rust">Edit display name</p>
      </button>
    );
  }

  return (
    <div className="flex-1">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="w-full h-9 bg-surface border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
      />
      <p className="font-body text-[11px] text-steel mt-1">
        This is what other members see on the feed and roster — it doesn&apos;t have to be your legal name.
      </p>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setName(initialName);
            setError(null);
            setEditing(false);
          }}
          disabled={saving}
          className="font-body text-xs text-steel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
