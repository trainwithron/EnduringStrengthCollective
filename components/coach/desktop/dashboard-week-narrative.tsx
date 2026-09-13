export function DashboardWeekNarrative({ text }: { text: string }) {
  return (
    <div className="border border-steel/20 bg-surface p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">This Week</h2>
      <p className="font-body text-sm text-chalk">{text}</p>
    </div>
  );
}
