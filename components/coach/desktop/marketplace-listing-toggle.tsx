"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Whether this organization appears in the public "find a coach" listing. Off by default: nothing about a coach is public
// until the owner or an admin turns this on.
export function MarketplaceListingToggle({
  organizationId,
  initialListed,
  canEdit,
  available,
}: {
  organizationId: string;
  initialListed: boolean;
  canEdit: boolean;
  // False until the database has the setting; the toggle is hidden rather than shown broken.
  available: boolean;
}) {
  const [listed, setListed] = useState(initialListed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) return null;

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("organizations")
      .update({ listed_in_marketplace: next })
      .eq("id", organizationId);
    setSaving(false);
    if (updateError) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setListed(next);
  }

  return (
    <div className="border border-steel/20 p-4 mb-8">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={listed}
          disabled={!canEdit || saving}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 w-5 h-5 accent-rust"
        />
        <span>
          <span className="font-body text-sm text-chalk block">List my organization in &ldquo;Find a coach&rdquo;</span>
          <span className="font-body text-xs text-steel block mt-0.5 max-w-[60ch]">
            Off by default. When on, people searching for a coach can see your organization&apos;s name and general area.
            {!canEdit ? " Only an owner or admin can change this." : ""}
          </span>
        </span>
      </label>
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
    </div>
  );
}
