"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface PrivatePackageOption {
  id: string;
  name: string;
  sessionsPerWeek: number;
  rateCents: number;
  sessionsGranted: number;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Only ever lists PRIVATE packages — a published one is already visible
// to every client, so assigning it here would do nothing. Writes
// directly to package_assignments via RLS (no API route): unlike
// coach_packages itself, this table has no Stripe side effect, matching
// the same direct-write pattern SessionCreditsControl/
// PrivateFromOrgToggle already use elsewhere on this page.
export function PackageAssignmentControl({
  athleteId,
  privatePackages,
  initialAssignedIds,
}: {
  athleteId: string;
  privatePackages: PrivatePackageOption[];
  initialAssignedIds: string[];
}) {
  const [assignedIds, setAssignedIds] = useState(new Set(initialAssignedIds));
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(packageId: string) {
    setBusyId(packageId);
    const supabase = createBrowserClient();
    const isAssigned = assignedIds.has(packageId);
    if (isAssigned) {
      await supabase
        .from("package_assignments")
        .delete()
        .eq("coach_package_id", packageId)
        .eq("athlete_id", athleteId);
    } else {
      await supabase.from("package_assignments").insert({ coach_package_id: packageId, athlete_id: athleteId });
    }
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (isAssigned) next.delete(packageId);
      else next.add(packageId);
      return next;
    });
    setBusyId(null);
  }

  return (
    <div>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
        Private packages assigned to this client
      </h2>
      {privatePackages.length === 0 ? (
        <p className="font-body text-sm text-steel">
          No private packages yet — create one from the Packages page to assign custom pricing here.
        </p>
      ) : (
        <div className="space-y-1.5">
          {privatePackages.map((pkg) => (
            <label key={pkg.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={assignedIds.has(pkg.id)}
                onChange={() => toggle(pkg.id)}
                disabled={busyId === pkg.id}
                className="accent-rust"
              />
              <span className="font-body text-sm">
                {pkg.name}{" "}
                <span className="text-steel text-xs">
                  ({pkg.sessionsPerWeek}x/week &middot; {formatDollars(pkg.rateCents)}/session)
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
