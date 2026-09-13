import { OuraConnection } from "@/components/athlete/oura-connection";
import { WithingsConnection } from "@/components/athlete/withings-connection";

// Oura and Withings are the first two real connections (real OAuth +
// daily sync — see app/api/oura/ and app/api/withings/); the rest stay
// as disabled "coming soon" rows until their own provider work lands —
// see the wearables scoping memory for why each is still just a
// placeholder (Garmin/Google Health need partner approval or
// app-verification lead time; Apple Health has no server API at all
// without a companion iOS app).
const COMING_SOON_PROVIDERS = ["Garmin", "Apple Health", "Google Health"];

export function WearablePlaceholder({
  groupId,
  ouraConnected,
  ouraStatus,
  ouraError,
  withingsConnected,
  withingsStatus,
  withingsError,
}: {
  groupId: string;
  ouraConnected: boolean;
  ouraStatus: "active" | "revoked" | "error" | null;
  ouraError: string | null;
  withingsConnected: boolean;
  withingsStatus: "active" | "revoked" | "error" | null;
  withingsError: string | null;
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
