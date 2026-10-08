"use client";

import { useState } from "react";
import { useDemosHidden, writeDemosHidden } from "@/components/logging/demo-preference";

// Settings: a client who does not want the Demo button on each exercise can turn it off. Saved to their account, so it follows them to their other devices.
export function HideDemosToggle() {
  const hidden = useDemosHidden();
  const [notSaved, setNotSaved] = useState(false);

  async function change(next: boolean) {
    setNotSaved(false);
    const saved = await writeDemosHidden(next);
    if (!saved) setNotSaved(true);
  }

  return (
    <div>
      <label className="flex items-start gap-3 min-h-11 cursor-pointer">
        <input type="checkbox" checked={hidden} onChange={(e) => void change(e.target.checked)} className="mt-1 h-5 w-5 accent-rust" />
        <span>
          <span className="block font-body text-sm text-chalk">Hide exercise demos</span>
          <span className="block font-body text-xs text-steel mt-0.5">Removes the Demo button from each exercise while you log. This follows you to your other devices.</span>
          {notSaved && (
            <span className="block font-body text-xs text-rust mt-0.5" role="status">
              {"It's off on this device, but it didn't save to your account. Try again when you're online."}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
