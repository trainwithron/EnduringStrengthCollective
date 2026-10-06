"use client";

import { useDemosHidden, writeDemosHidden } from "@/components/logging/demo-preference";

// Settings: a client who does not want the Demo button on each exercise can turn it off. Kept on this device.
export function HideDemosToggle() {
  const hidden = useDemosHidden();
  return (
    <div>
      <label className="flex items-start gap-3 min-h-11 cursor-pointer">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => writeDemosHidden(e.target.checked)}
          className="mt-1 h-5 w-5 accent-rust"
        />
        <span>
          <span className="block font-body text-sm text-chalk">Hide exercise demos</span>
          <span className="block font-body text-xs text-steel mt-0.5">
            Removes the Demo button from each exercise while you log. This is saved on this device only.
          </span>
        </span>
      </label>
    </div>
  );
}
