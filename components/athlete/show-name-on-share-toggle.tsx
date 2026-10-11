"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Settings: whether the client's first name is printed on the workout picture they share (and on the card's link preview). On by default for everyone. With it off the
// picture and card carry no name at all.
export function ShowNameOnShareToggle({ profileId, initialOn }: { profileId: string; initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [notSaved, setNotSaved] = useState(false);

  async function change(next: boolean) {
    const previous = on;
    setOn(next);
    setNotSaved(false);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("profiles").update({ show_name_on_share: next }).eq("id", profileId);
    if (error) {
      setOn(previous);
      setNotSaved(true);
    }
  }

  return (
    <div>
      <label className="flex items-start gap-3 min-h-11 cursor-pointer">
        <input type="checkbox" checked={on} onChange={(e) => void change(e.target.checked)} className="mt-1 h-5 w-5 accent-rust" />
        <span>
          <span className="block font-body text-sm text-chalk">Show my first name on shared workout pictures</span>
          <span className="block font-body text-xs text-steel mt-0.5">When this is off, the picture you share has no name on it.</span>
          {notSaved && (
            <span className="block font-body text-xs text-rust mt-0.5" role="alert">
              {"Couldn't save that. Check your connection and try again."}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
