"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface AssignableClientTag {
  id: string;
  name: string;
}

// organizational_only_group_kind_idea_sept16.md — per-client side of the
// org-wide client-tags system (tag creation lives on the org's Branding
// page's Tags tab). Toggling a tag here writes/deletes a
// client_tag_assignments row directly, same immediate-persist,
// no-API-route convention as SessionCreditsControl/PrivateFromOrgToggle
// on this same profile page.
export function ClientTagAssignmentControl({
  athleteId,
  orgTags,
  initialAssignedTagIds,
}: {
  athleteId: string;
  orgTags: AssignableClientTag[];
  initialAssignedTagIds: string[];
}) {
  const [assigned, setAssigned] = useState(new Set(initialAssignedTagIds));

  if (orgTags.length === 0) return null;

  async function toggleTag(tagId: string) {
    const supabase = createBrowserClient();
    const isAssigned = assigned.has(tagId);
    setAssigned((prev) => {
      const next = new Set(prev);
      isAssigned ? next.delete(tagId) : next.add(tagId);
      return next;
    });
    if (isAssigned) {
      await supabase.from("client_tag_assignments").delete().eq("tag_id", tagId).eq("athlete_id", athleteId);
    } else {
      await supabase
        .from("client_tag_assignments")
        .upsert({ tag_id: tagId, athlete_id: athleteId }, { onConflict: "tag_id,athlete_id", ignoreDuplicates: true });
    }
  }

  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Client Tags</p>
      <div className="flex flex-wrap gap-2">
        {orgTags.map((tag) => {
          const isAssigned = assigned.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className={`h-8 px-3 font-body text-xs border transition-colors ${
                isAssigned ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel active:border-rust"
              }`}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
