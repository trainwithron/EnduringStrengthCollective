"use client";

import { useState } from "react";
import { GroupEventForm } from "@/components/coach/group-event-form";
import { useTerm } from "@/components/coach/terminology-provider";

// The "Add a group event" button on the coach's Calendar: opens the form (with the group picked in it). Shown only when the coach has a group to add it to.
export function AddGroupEvent({ groups, timezone }: { groups: { id: string; name: string }[]; timezone: string }) {
  const term = useTerm();
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm hover:border-rust"
      >
        {open ? "Close" : `Add a ${term("group")} event`}
      </button>
      {open && (
        <div className="mt-3 max-w-xl">
          <GroupEventForm groups={groups} timezone={timezone} />
        </div>
      )}
    </div>
  );
}
