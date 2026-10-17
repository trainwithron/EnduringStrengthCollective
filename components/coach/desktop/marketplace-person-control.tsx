"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Whether THIS coach appears in the public "Find a coach" list, and under what name. Off by default, and separate from the organization's own switch: a coach is shown only when the organization is listed
// AND the coach themselves has turned this on. With no name typed, only first name and last initial are shown ("Sam R.").
export function MarketplacePersonControl({
  profileId,
  initialListed,
  initialName,
  available,
}: {
  profileId: string;
  initialListed: boolean;
  initialName: string;
  // False until the database has the setting; the control is hidden rather than shown broken.
  available: boolean;
}) {
  const [listed, setListed] = useState(initialListed);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!available) return null;

  async function save(patch: { marketplace_listed?: boolean; marketplace_display_name?: string | null }) {
    setSaving(true);
    setError(null);
    const { error: updateError } = await createBrowserClient().from("profiles").update(patch).eq("id", profileId);
    setSaving(false);
    if (updateError) {
      setError("That didn't save. Nothing was changed.");
      return false;
    }
    return true;
  }

  return (
    <div className="border border-steel/20 p-4 mb-8">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={listed}
          disabled={saving}
          onChange={async (e) => {
            const next = e.target.checked;
            if (await save({ marketplace_listed: next })) setListed(next);
          }}
          className="mt-0.5 w-5 h-5 accent-rust"
        />
        <span>
          <span className="font-body text-sm text-chalk block">Show me in &ldquo;Find a coach&rdquo;</span>
          <span className="font-body text-xs text-steel block mt-0.5 max-w-[60ch]">Off by default. You appear only if your organization is listed and this is on.</span>
        </span>
      </label>
      <label className="block mt-3">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Name to show</span>
        <input
          type="text"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save({ marketplace_display_name: name.trim() || null })}
          placeholder="Leave empty to show first name and last initial"
          className="mt-1 w-full max-w-sm h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
