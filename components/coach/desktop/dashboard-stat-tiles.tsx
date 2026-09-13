import type { DashboardStatTiles } from "@/lib/dashboard-data";

// Static bento stat tiles — real numbers, always in this fixed
// arrangement for now. Tap-to-swap/hover-peek and show/hide/reorder are
// the customization layer, deliberately deferred to a later pass
// (coach_dashboard_redesign_scoping.md's own recommended build order:
// static layout first, customization last).
export function DashboardStatTiles({ stats }: { stats: DashboardStatTiles }) {
  const tiles = [
    { label: "Clients", value: String(stats.rosterSize) },
    { label: "Active this week", value: `${stats.activeThisWeekPct}%` },
    { label: "Need attention", value: String(stats.needsAttentionCount) },
    { label: "Est. MRR", value: `$${stats.estimatedMrr.toLocaleString()}` },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="border border-steel/20 bg-surface p-4 text-center">
          <p className="font-display font-bold text-2xl leading-none text-chalk">{tile.value}</p>
          <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-2">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}
