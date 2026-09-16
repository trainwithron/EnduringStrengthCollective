import { OuraConnection } from "@/components/athlete/oura-connection";
import { WithingsConnection } from "@/components/athlete/withings-connection";
import { GarminConnection } from "@/components/athlete/garmin-connection";
import { GoogleHealthConnection } from "@/components/athlete/google-health-connection";

// Oura, Withings, Garmin, and Google Health are the real connections
// (real OAuth + sync — see app/api/oura/, app/api/withings/,
// app/api/garmin/, app/api/google-health/). Apple Health stays a
// disabled "coming soon" row — it has no server API at all without a
// companion iOS app (see the wearables scoping memory).
const COMING_SOON_PROVIDERS = ["Apple Health"];

export function WearablePlaceholder({
  groupId,
  ouraConnected,
  ouraStatus,
  ouraError,
  withingsConnected,
  withingsStatus,
  withingsError,
  garminConnected,
  garminStatus,
  garminError,
  googleHealthConnected,
  googleHealthStatus,
  googleHealthError,
}: {
  groupId: string;
  ouraConnected: boolean;
  ouraStatus: "active" | "revoked" | "error" | null;
  ouraError: string | null;
  withingsConnected: boolean;
  withingsStatus: "active" | "revoked" | "error" | null;
  withingsError: string | null;
  garminConnected: boolean;
  garminStatus: "active" | "revoked" | "error" | null;
  garminError: string | null;
  googleHealthConnected: boolean;
  googleHealthStatus: "active" | "revoked" | "error" | null;
  googleHealthError: string | null;
}) {
  return (
    <div>
      <p className="font-body text-sm mb-1">Wearables</p>
      <p className="font-body text-xs text-steel mb-3">
        Connect a device to see sleep, step, and weight trends on your profile.
      </p>
      <div className="space-y-1.5">
        <OuraConnection
          groupId={groupId}
          connected={ouraConnected}
          status={ouraStatus}
          initialError={ouraError}
        />
        <WithingsConnection
          groupId={groupId}
          connected={withingsConnected}
          status={withingsStatus}
          initialError={withingsError}
        />
        <GarminConnection
          groupId={groupId}
          connected={garminConnected}
          status={garminStatus}
          initialError={garminError}
        />
        <GoogleHealthConnection
          groupId={groupId}
          connected={googleHealthConnected}
          status={googleHealthStatus}
          initialError={googleHealthError}
        />
        {COMING_SOON_PROVIDERS.map((p) => (
          <div
            key={p}
            className="flex items-center justify-between h-10 px-3 border border-steel/15 opacity-50"
          >
            <span className="font-body text-sm">{p}</span>
            <span className="font-body text-[11px] text-steel uppercase tracking-wide">
              Coming soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
