// Placeholder only, per explicit instruction — wearable sync isn't
// happening yet. This just shows the intended providers as disabled
// "coming soon" rows so the shape of the feature is visible in the UI;
// wearable_connections exists in the schema for when this becomes real.
const PROVIDERS = ["Garmin", "Apple Health", "Google Health"];

export function WearablePlaceholder() {
  return (
    <div>
      <p className="font-body text-sm mb-1">Wearables</p>
      <p className="font-body text-xs text-steel mb-3">Coming soon — not connected yet.</p>
      <div className="space-y-1.5">
        {PROVIDERS.map((p) => (
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
